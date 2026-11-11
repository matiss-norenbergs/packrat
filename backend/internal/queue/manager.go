package queue

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"packrat/backend/internal/bgtasks"
	"packrat/backend/internal/db"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/fsutil"
	"packrat/backend/internal/ghostthumb"
	"packrat/backend/internal/imagefetch"
	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/importer"
	"packrat/backend/internal/itemlock"
	"packrat/backend/internal/jellyfin"
	"packrat/backend/internal/metaembed"
	"packrat/backend/internal/models"
	"packrat/backend/internal/nametemplate"
	"packrat/backend/internal/nfo"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/thumbnailenhance"
	"packrat/backend/internal/ws"
)

// jellyfinRefreshDebounce is how long the manager waits after the most
// recent completed download before actually calling Jellyfin — a burst of
// downloads (e.g. a playlist) finishing within this window collapses into
// one rescan instead of one per download.
const jellyfinRefreshDebounce = 20 * time.Second

// progressBroadcastInterval throttles per-download progress events to at
// most once per this interval, per the WebSocket Throttling requirement —
// raw yt-dlp progress ticks (dozens/sec for small chunks) are never
// forwarded 1:1 to clients.
const progressBroadcastInterval = time.Second

// libraryThumbnailTiers mirrors api.libraryThumbnailTiers — kept as a
// separate copy here since queue can't import api (api already imports
// queue) and this is the only place in this package that needs it.
var libraryThumbnailTiers = []imageproc.Tier{
	{Name: "small", MaxWidth: imageproc.ThumbnailSmallWidth},
	{Name: "medium", MaxWidth: imageproc.ThumbnailMediumWidth},
}

type DownloadManager struct {
	mediaRoot                         string
	imagesRoot                        string
	ffprobePath                       string
	ytdlp                             *downloader.YtDlpService
	downloadsRepo                     *repository.DownloadsRepo
	libraryRepo                       *repository.LibraryRepo
	collectionsRepo                   *repository.CollectionsRepo
	historyRepo                       *repository.HistoryRepo
	artistsRepo                       *repository.ArtistsRepo
	tagsRepo                          *repository.TagsRepo
	settingsRepo                      *repository.SettingsRepo
	thumbnailEnhancementHistoryRepo   *repository.ThumbnailEnhancementHistoryRepo
	thumbnailEnhancementOriginalsRepo *repository.ThumbnailEnhancementOriginalsRepo
	jellyfinClient                    *jellyfin.Client
	jellyfinDebounce                  *jellyfin.Debouncer
	tasks                             *bgtasks.Tracker // shutdown waits for workers and detached jobs; nil = untracked
	progress                          *ProgressStore
	broadcaster                       ws.Broadcaster
	itemLocks                         *itemlock.Locks      // serializes writes/moves/deletes of an item's media file (package itemlock)
	embedder                          *metaembed.Scheduler // background metadata remux, run under the item lock

	// jobs is the unbounded in-memory FIFO of queued download ids waiting for
	// a worker (see jobQueue). Persisted rows stay the source of truth.
	jobs *jobQueue

	// rootCtx is the single stable context every runOne call derives its
	// per-download runCtx from. It is set once in Start and never touched by
	// worker pool resizing — a worker's own stop signal only gates whether it
	// picks up its *next* job, so shrinking the pool can never cancel a
	// download that's already in flight.
	rootCtx context.Context

	workerMu    sync.Mutex
	workerStops []chan struct{}

	mu      sync.Mutex
	cancels map[int64]context.CancelFunc
	// runGhosts maps a running download's id to the ghost library row the run
	// is filling in (see ensureGhost); guarded by mu, cleared when the run ends.
	runGhosts map[int64]ghostRun

	lastBroadcastMu sync.Mutex
	lastBroadcastAt map[int64]time.Time

	activeCount int32

	// Test hooks (nil in production) that open the S4-7 race windows in runOne
	// deterministically: hookAfterLoad runs once the row is loaded and known not
	// to be cancelled, hookAfterRegister once the cancel func is registered; both
	// before the conditional queued -> fetching_metadata transition.
	hookAfterLoad     func(id int64)
	hookAfterRegister func(id int64)
}

// maxConcurrentEmbeds caps simultaneous metadata remuxes (each is an ffmpeg
// process). A small fixed number rather than the (runtime-editable) download
// worker count, since a remux is short and CPU-light next to a download.
const maxConcurrentEmbeds = 4

// ItemLocks is the per-library-item lock shared with the API handlers.
func (m *DownloadManager) ItemLocks() *itemlock.Locks { return m.itemLocks }

// Embedder is the shared background metadata-embed scheduler.
func (m *DownloadManager) Embedder() *metaembed.Scheduler { return m.embedder }

// currentMediaPath is the metaembed.CurrentPathFunc: the item's current
// absolute media path, ok=false when it is gone or has no file.
func (m *DownloadManager) currentMediaPath(ctx context.Context, id int64) (string, bool) {
	item, err := m.libraryRepo.Get(ctx, id)
	if err != nil || item.Path == "" {
		return "", false
	}
	return filepath.Join(m.mediaRoot, filepath.FromSlash(item.Path)), true
}

func NewDownloadManager(
	mediaRoot, imagesRoot, ffprobePath string,
	ytdlp *downloader.YtDlpService,
	downloadsRepo *repository.DownloadsRepo,
	libraryRepo *repository.LibraryRepo,
	collectionsRepo *repository.CollectionsRepo,
	historyRepo *repository.HistoryRepo,
	artistsRepo *repository.ArtistsRepo,
	tagsRepo *repository.TagsRepo,
	settingsRepo *repository.SettingsRepo,
	thumbnailEnhancementHistoryRepo *repository.ThumbnailEnhancementHistoryRepo,
	thumbnailEnhancementOriginalsRepo *repository.ThumbnailEnhancementOriginalsRepo,
	jellyfinClient *jellyfin.Client,
	progress *ProgressStore,
	broadcaster ws.Broadcaster,
) *DownloadManager {
	m := &DownloadManager{
		mediaRoot:                         mediaRoot,
		imagesRoot:                        imagesRoot,
		ffprobePath:                       ffprobePath,
		ytdlp:                             ytdlp,
		downloadsRepo:                     downloadsRepo,
		libraryRepo:                       libraryRepo,
		collectionsRepo:                   collectionsRepo,
		historyRepo:                       historyRepo,
		artistsRepo:                       artistsRepo,
		tagsRepo:                          tagsRepo,
		settingsRepo:                      settingsRepo,
		thumbnailEnhancementHistoryRepo:   thumbnailEnhancementHistoryRepo,
		thumbnailEnhancementOriginalsRepo: thumbnailEnhancementOriginalsRepo,
		jellyfinClient:                    jellyfinClient,
		progress:                          progress,
		broadcaster:                       broadcaster,
		jobs:                              newJobQueue(),
		cancels:                           make(map[int64]context.CancelFunc),
		runGhosts:                         make(map[int64]ghostRun),
		lastBroadcastAt:                   make(map[int64]time.Time),
	}
	m.itemLocks = itemlock.New()
	m.embedder = metaembed.New(m.itemLocks, ytdlp, m.currentMediaPath, maxConcurrentEmbeds)
	m.jellyfinDebounce = jellyfin.NewDebouncer(jellyfinRefreshDebounce, m.doJellyfinRefresh)
	return m
}

// ResolveEffectiveRoot returns the directory downloads should be written
// under: a collection's root (itself resolved safely under MediaRoot) when
// collectionID is set, otherwise MediaRoot directly. Both the API layer
// (pre-validating the request's folder) and runOne (actually resolving the
// destination) call this so the two never drift apart.
func (m *DownloadManager) ResolveEffectiveRoot(ctx context.Context, collectionID *int64) (string, error) {
	if collectionID == nil {
		return m.mediaRoot, nil
	}
	relPath, err := m.collectionsRepo.ResolvePath(ctx, *collectionID)
	if err != nil {
		return "", err
	}
	return pathsafe.ResolveUnderRoot(m.mediaRoot, relPath)
}

// SetTracker makes the worker pool and detached background jobs register with
// t, so shutdown can wait for them. Call before Start.
func (m *DownloadManager) SetTracker(t *bgtasks.Tracker) { m.tasks = t }

// Start records the process-lifetime context every download runs under,
// then brings the worker pool up to workerCount. The number of workers *is*
// the concurrency limit ("configurable max concurrent downloads") — no
// separate semaphore is needed.
func (m *DownloadManager) Start(ctx context.Context, workerCount int) {
	m.rootCtx = ctx
	m.SetWorkerCount(workerCount)
}

func (m *DownloadManager) worker(stop <-chan struct{}) {
	for {
		id, ok := m.jobs.Pop(m.rootCtx, stop)
		if !ok {
			return // pool shrank or the server is shutting down
		}
		m.runOne(m.rootCtx, id)
	}
}

// SetWorkerCount resizes the pool to n workers, spawning or stopping as
// needed. Stopping a worker only prevents it from picking up its *next*
// job — any download it's currently running keeps going via rootCtx, which
// is never touched here.
func (m *DownloadManager) SetWorkerCount(n int) {
	if n > models.MaxConcurrentDownloadsLimit {
		// Last guard: the API and the restore path already limit it, but a saved
		// value from before the limit (or the env var) can still arrive here.
		log.Printf("queue: worker count %d is above the limit, using %d", n, models.MaxConcurrentDownloadsLimit)
		n = models.MaxConcurrentDownloadsLimit
	}
	m.workerMu.Lock()
	defer m.workerMu.Unlock()

	current := len(m.workerStops)
	switch {
	case n > current:
		for i := 0; i < n-current; i++ {
			stop := make(chan struct{})
			m.workerStops = append(m.workerStops, stop)
			m.tasks.Go(func() { m.worker(stop) })
		}
	case n < current:
		for i := 0; i < current-n; i++ {
			last := len(m.workerStops) - 1
			close(m.workerStops[last])
			m.workerStops = m.workerStops[:last]
		}
	}
}

// WorkerCount returns the current pool size — the live source of truth for
// GET /api/settings, since it reflects SetWorkerCount calls immediately.
func (m *DownloadManager) WorkerCount() int {
	m.workerMu.Lock()
	defer m.workerMu.Unlock()
	return len(m.workerStops)
}

// Enqueue creates a queued download row and schedules it for a worker. It
// never waits for a free worker: the id goes onto an unbounded FIFO and the
// call returns, whatever the queue length. While the server is shutting down
// it refuses with ErrShuttingDown instead of creating a row no worker will
// ever run.
func (m *DownloadManager) Enqueue(ctx context.Context, d models.Download) (int64, error) {
	if !IsHTTPURL(d.URL) {
		return 0, ErrInvalidURL
	}
	if m.shuttingDown() {
		return 0, ErrShuttingDown
	}
	d.Status = models.StatusQueued
	id, err := m.downloadsRepo.Create(ctx, &d)
	if err != nil {
		return 0, err
	}
	m.jobs.Push(id)
	m.broadcastQueueUpdate()
	return id, nil
}

// shuttingDown reports whether Start's context has been cancelled. Before Start
// (tests) there is no root context and the manager is not shutting down.
func (m *DownloadManager) shuttingDown() bool {
	return m.rootCtx != nil && m.rootCtx.Err() != nil
}

// ErrShuttingDown is returned by Enqueue once the server has begun shutting
// down; the API maps it to 503.
var ErrShuttingDown = errors.New("server is shutting down; try again once it is back")

// ErrInvalidURL is returned by Enqueue for a URL that is not an absolute
// http(s) URL. Enqueue is the single place URL schemes are enforced.
var ErrInvalidURL = errors.New("url must be an http or https URL")

// IsHTTPURL reports whether raw is an absolute http(s) URL with a host.
func IsHTTPURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

// Cancel stops an in-flight download, or marks a not-yet-started one as
// cancelled so its worker skips it when dequeued.
func (m *DownloadManager) Cancel(ctx context.Context, id int64) error {
	m.mu.Lock()
	cancel, running := m.cancels[id]
	m.mu.Unlock()

	if running {
		cancel()
		return nil
	}

	d, err := m.downloadsRepo.Get(ctx, id)
	if err != nil {
		return err
	}
	if d.Status != models.StatusQueued && d.Status != models.StatusFetchingMetadata {
		return fmt.Errorf("download %d is not cancellable in status %q", id, d.Status)
	}
	// Conditional: a worker may have started or finished the download since
	// the Get above. Whoever changes the row first wins; if that was not us the
	// download is no longer cancellable. (If it was a worker that registered its
	// cancel func in the meantime, runOne's own conditional start sees our
	// cancelled row and skips the run.)
	cancelled, err := m.downloadsRepo.MarkCancelledIfPending(ctx, id)
	if err != nil {
		return err
	}
	if !cancelled {
		return fmt.Errorf("download %d is not cancellable: it already started or finished", id)
	}
	// Take it out of the FIFO now so the Queued count drops at once and no
	// worker ever pops it. If a worker already did, runOne's cancelled-status
	// check is the safety net.
	m.jobs.Remove(id)
	m.broadcastQueueUpdate()
	return nil
}

func (m *DownloadManager) runOne(parentCtx context.Context, id int64) {
	d, err := m.downloadsRepo.Get(parentCtx, id)
	if err != nil {
		log.Printf("queue: failed to load download %d: %v", id, err)
		return
	}
	if d.Status == models.StatusCancelled {
		return // cancelled while still queued, nothing to do
	}
	if m.hookAfterLoad != nil {
		m.hookAfterLoad(id)
	}

	// A configured timeout (0 = disabled, the default) wraps the whole run —
	// metadata fetch through the actual yt-dlp/ffmpeg process — in a deadline
	// instead of a plain cancel-only context. The returned cancel still goes
	// into m.cancels[id] either way, so manual Cancel() keeps working
	// unchanged; exec.CommandContext (already used throughout
	// downloader.YtDlpService) is what actually kills the subprocess when
	// the context ends, the same mechanism manual cancel already relies on.
	timeoutRaw, err := m.settingsRepo.Get(parentCtx, models.SettingDownloadTimeoutMinutes)
	timeoutMinutes, convErr := strconv.Atoi(timeoutRaw)
	if err != nil || convErr != nil || timeoutMinutes < 0 {
		timeoutMinutes = 0
	}

	var runCtx context.Context
	var cancel context.CancelFunc
	if timeoutMinutes > 0 {
		runCtx, cancel = context.WithTimeout(parentCtx, time.Duration(timeoutMinutes)*time.Minute)
	} else {
		runCtx, cancel = context.WithCancel(parentCtx)
	}
	// Register the cancel func BEFORE the conditional queued -> fetching_metadata
	// transition below. A concurrent Cancel then either sees it (running branch:
	// it calls cancel, and the transition below fails or is followed by a
	// cancelled run) or finds none, in which case its MarkCancelledIfPending
	// has landed (or lands) while the row is still queued and the conditional
	// transition changes 0 rows. Either way the download ends cancelled and is
	// never started; the old unconditional UpdateStatus could overwrite a
	// concurrent cancel with fetching_metadata and download anyway (S4-7).
	m.mu.Lock()
	m.cancels[id] = cancel
	m.mu.Unlock()
	releaseCancel := func() {
		m.mu.Lock()
		delete(m.cancels, id)
		m.mu.Unlock()
		cancel()
	}
	if m.hookAfterRegister != nil {
		m.hookAfterRegister(id)
	}

	started, err := m.downloadsRepo.MarkFetchingMetadataIfQueued(runCtx, id)
	switch {
	case err != nil && runCtx.Err() != nil:
		// Cancelled (or timed out) before it began: record it like any other
		// cancelled run, without ever starting the subprocess.
		m.finishError(parentCtx, runCtx, id, d.URL, runCtx.Err().Error(), "", "")
		releaseCancel()
		return
	case err != nil:
		log.Printf("queue: update status failed for %d: %v", id, err)
	case !started:
		// Cancelled (or deleted) after this worker loaded the row: nothing to
		// run, and nothing to record — Cancel already wrote the outcome.
		releaseCancel()
		return
	}

	atomic.AddInt32(&m.activeCount, 1)
	defer func() {
		atomic.AddInt32(&m.activeCount, -1)
		m.mu.Lock()
		delete(m.cancels, id)
		delete(m.runGhosts, id)
		m.mu.Unlock()
		cancel()
		m.progress.Delete(id)
		m.lastBroadcastMu.Lock()
		delete(m.lastBroadcastAt, id)
		m.lastBroadcastMu.Unlock()
		m.broadcastQueueUpdate()
	}()

	var meta *downloader.Metadata
	if d.DownloadType == "image" {
		// A bare image URL isn't a video-hosting page — yt-dlp's extractors
		// don't reliably recognize it, so the metadata fetch is skipped
		// entirely rather than attempted and ignored. titleFromURL gives
		// effectiveTitle below something readable to fall back to before it
		// falls back to the raw URL itself.
		meta = &downloader.Metadata{Title: titleFromURL(d.URL)}
	} else {
		meta, err = m.ytdlp.FetchMetadata(runCtx, d.URL)
		if err != nil {
			m.finishError(parentCtx, runCtx, id, d.URL, err.Error(), "", "")
			return
		}
	}
	duration := int(meta.Duration)
	if err := m.downloadsRepo.UpdateMetadata(runCtx, id, strPtr(meta.ID), strPtr(meta.Title), strPtr(meta.Uploader), &duration, strPtr(meta.Thumbnail)); err != nil {
		log.Printf("queue: update metadata failed for %d: %v", id, err)
	}

	// effectiveTitle folds in the manual override (if any set at request
	// time) ahead of the URL fallback — computed once here so both the
	// filename-prefix combination below and buildLibraryItem use the exact
	// same value.
	effectiveTitle := meta.Title
	if d.OverrideTitle != nil && *d.OverrideTitle != "" {
		effectiveTitle = *d.OverrideTitle
	}
	if effectiveTitle == "" {
		effectiveTitle = d.URL
	}

	effectiveRoot, err := m.ResolveEffectiveRoot(runCtx, d.CollectionID)
	if err != nil {
		m.finishError(parentCtx, runCtx, id, d.URL, "resolving collection root: "+err.Error(), "", "")
		return
	}

	audioFormat := ""
	if d.AudioFormat != nil {
		audioFormat = *d.AudioFormat
	}

	var destDir, filename string
	isRedownload := d.TargetLibraryItemID != nil
	if isRedownload {
		// Redownload: land in the shared scratch folder, not the
		// collection folder — completeRedownload only swaps this over the
		// real file once the download has fully succeeded. The literal
		// destination filename/template/prefix machinery below is
		// irrelevant here: the final name is dictated by the existing
		// library item, not derived from title/prefix/template.
		destDir = downloader.TrimTmpDir(m.mediaRoot)
		if err := fsutil.EnsureDir(destDir); err != nil {
			m.finishError(parentCtx, runCtx, id, d.URL, "creating scratch directory: "+err.Error(), "", "")
			return
		}
		uid := strconv.FormatInt(time.Now().UnixNano(), 36)
		filename = fsutil.SanitizeFilename(fmt.Sprintf("redownload-%d-%s", *d.TargetLibraryItemID, uid))
	} else {
		destDir, err = pathsafe.ResolveUnderRoot(effectiveRoot, d.Folder)
		if err != nil {
			m.finishError(parentCtx, runCtx, id, d.URL, "invalid folder: "+err.Error(), "", "")
			return
		}

		var templateVars nametemplate.Vars
		if d.FilenameTemplate != nil && strings.TrimSpace(*d.FilenameTemplate) != "" {
			templateVars = m.filenameTemplateVars(runCtx, d, effectiveTitle, meta)
		}
		var resolvedFilename string
		var extraDirSegments []string
		resolvedFilename, extraDirSegments = resolveFilename(d.Filename, d.FilenameTemplate, d.FilenamePrefix, effectiveTitle, templateVars)
		if len(extraDirSegments) > 0 {
			destDir = filepath.Join(append([]string{destDir}, extraDirSegments...)...)
		}
		if resolvedFilename == "" && d.DownloadType == "image" {
			// resolveFilename's "" return means "let yt-dlp fall back to its
			// own default naming" — there's no yt-dlp in the image path to do
			// that, so fall back to the effective title directly (mirrors
			// what yt-dlp's own %(title)s default would have produced).
			resolvedFilename = effectiveTitle
		}
		filename = fsutil.SanitizeFilename(resolvedFilename)

		if err := fsutil.EnsureDir(destDir); err != nil {
			m.finishError(parentCtx, runCtx, id, d.URL, "creating destination directory: "+err.Error(), "", "")
			return
		}
	}

	// Metadata fetched and the destination checked out: this is the point a
	// download is known to be real, so its library item appears now (as a
	// ghost) instead of only when the file lands. Images skip metadata and
	// redownloads already have their item, so neither gets one.
	if !isRedownload && d.DownloadType != "image" {
		m.ensureGhost(runCtx, id, d, effectiveTitle, meta)
	}

	if err := m.downloadsRepo.UpdateStatus(runCtx, id, models.StatusDownloading, nil); err != nil {
		log.Printf("queue: update status failed for %d: %v", id, err)
	}
	m.broadcastQueueUpdate()

	var result downloader.RunResult
	if d.DownloadType == "image" {
		// No yt-dlp involved at all — a bare image URL isn't a video-hosting
		// page, so this is a plain HTTP GET plus an optional format
		// conversion instead of a subprocess invocation.
		result, err = m.runImageDownload(runCtx, id, d, destDir, filename, isRedownload)
		if err != nil {
			m.finishError(parentCtx, runCtx, id, d.URL, err.Error(), "", "")
			return
		}
	} else {
		job := downloader.DownloadJob{
			URL:            d.URL,
			DestDir:        destDir,
			Filename:       filename,
			DownloadType:   d.DownloadType,
			Quality:        d.Quality,
			AudioFormat:    audioFormat,
			ForceOverwrite: isRedownload,
		}

		var ok bool
		result, ok = m.runYtDlp(parentCtx, runCtx, id, d, job)
		if !ok {
			return
		}
		if !isRedownload {
			// A file another library row owns is never reused: yt-dlp skips a
			// download whose output path exists, which would make this item a
			// second row on someone else's file. Redownloads use a scratch file.
			result, ok = m.resolveNameClash(parentCtx, runCtx, id, d, job, meta, result)
			if !ok {
				return
			}
		}
		if result.ExitCode != 0 && outputFileExists(result.FinalPath) {
			cleanupOrphanedThumbnailArtifacts(result.FinalPath)
		}
	}

	// A run that ends without a stored output file is a failure whatever the
	// exit code: exit 0 with no after_move path (e.g. a playlist URL that
	// resolved to zero entries) must not become a "completed" item with an
	// empty path. A ghost made for this run stays as an ordinary ghost.
	if !outputFileExists(result.FinalPath) {
		m.finishError(parentCtx, runCtx, id, d.URL, "yt-dlp finished without reporting an output file", result.StdoutTail, result.StderrTail)
		return
	}

	if err := m.downloadsRepo.SetCommand(parentCtx, id, result.Command); err != nil {
		log.Printf("queue: set command failed for %d: %v", id, err)
	}

	// Resolution/duration are re-derived from the actual downloaded file,
	// not carried forward from the pre-download metadata fetch above (meta
	// reflects yt-dlp's default/"best" format, which isn't guaranteed to
	// match whatever the quality selector actually picked — and duration in
	// particular can genuinely change, e.g. a trimmed live stream). Falls
	// back to the metadata values only if ffprobe can't read the file.
	probe := importer.Probe(runCtx, m.ffprobePath, result.FinalPath)
	resolution := probe.Resolution
	if resolution == nil && meta.Width > 0 && meta.Height > 0 {
		r := fmt.Sprintf("%dx%d", meta.Width, meta.Height)
		resolution = &r
	}
	finalDuration := int(meta.Duration)
	if probe.DurationSeconds != nil {
		finalDuration = *probe.DurationSeconds
	}

	var sizeBytes *int64
	if info, err := os.Stat(result.FinalPath); err == nil {
		s := info.Size()
		sizeBytes = &s
	}

	if isRedownload {
		// completeRedownload handles its own MarkCompleted/history — on a
		// swap failure it routes through finishError instead, so the
		// download row never claims "completed" for a redownload whose
		// file was never actually swapped into place, and no duplicate
		// history entry results.
		m.completeRedownload(parentCtx, runCtx, id, d, effectiveTitle, meta, result, resolution, finalDuration, sizeBytes, effectiveRoot)
		return
	}

	// The library row comes first: the download is only recorded as completed
	// once the file has an item to belong to.
	adopted := strings.Contains(result.StdoutTail, alreadyDownloadedMarker)
	ghostID := m.runGhostID(id)
	libItem := m.buildLibraryItem(id, d, effectiveTitle, meta, result.FinalPath, resolution, finalDuration, sizeBytes)
	libItem.GenerateNFO = d.GenerateNFO
	// These writes record the outcome, so they must land even if shutdown
	// cancelled parentCtx while the download was finishing. The bound is long (CompletionContext)
	// and a busy database is retried (db.RetryBusy): a short bound, or giving up after the 15 s
	// busy timeout, would fail a write that merely queued behind another transaction's write lock
	// and delete the finished file below. Shutdown is not extended by it (the shutdown
	// wait is bounded, and an interrupted write is recovered by MarkInterruptedIfActive at next start).
	termCtx, termDone := bgtasks.CompletionContext(parentCtx)
	libID, ghost, err := m.fillOrCreateLibraryItem(termCtx, id, libItem)
	if err != nil {
		termDone()
		log.Printf("queue: creating library item failed for %d: %v", id, err)
		// Remove what this run wrote so a retry doesn't hit "already
		// downloaded" — but only what this run created: a file yt-dlp skipped
		// because it already existed (adopted, or owned by another item) stays.
		// An image's "sidecar" path could be another item's jpg.
		if !adopted && !m.pathClaimedByOther(parentCtx, result.FinalPath, ghostID) {
			os.Remove(result.FinalPath)
			if d.DownloadType != "image" {
				os.Remove(thumbnailPathFor(result.FinalPath))
			}
		}
		m.finishError(parentCtx, runCtx, id, d.URL, "creating library item: "+err.Error(), result.StdoutTail, result.StderrTail)
		return
	}
	if err := db.RetryBusy(termCtx, func() error {
		return m.downloadsRepo.MarkCompleted(termCtx, id, 0, resolution, result.StdoutTail, result.StderrTail)
	}); err != nil {
		log.Printf("queue: mark completed failed for %d: %v", id, err)
	}
	if _, err := db.RetryBusyValue(termCtx, func() (int64, error) {
		return m.historyRepo.Create(termCtx, &id, d.URL, "completed", nil)
	}); err != nil {
		log.Printf("queue: recording history for %d failed: %v", id, err)
	}
	termDone()

	// Best-effort — a failed derivative generation shouldn't fail the whole
	// download; the item just falls back to the original thumbnail until a
	// later edit (or the backfill tool) regenerates them.
	if libItem.Thumbnail != nil {
		thumbAbs := filepath.Join(m.mediaRoot, filepath.FromSlash(*libItem.Thumbnail))
		if tiers, err := imageproc.GenerateTiersFromPath(parentCtx, m.ytdlp.FFmpegPath, m.imagesRoot, "library", libID, thumbAbs, libraryThumbnailTiers); err != nil {
			log.Printf("queue: generating thumbnail derivatives for library item %d failed: %v", libID, err)
		} else {
			var width, height *int
			if d.DownloadType == "image" {
				// thumbAbs IS the downloaded image here (see buildLibraryItem),
				// which may not be JPEG (depends on the configured convert
				// format) — imageproc.ProbeDimensions only decodes JPEG
				// headers, so reuse the dimensions already probed via ffprobe
				// into resolution instead of re-probing a possibly-unsupported
				// format.
				if resolution != nil {
					if w, h, ok := parseResolution(*resolution); ok {
						width, height = &w, &h
					}
				}
			} else if w, h, err := imageproc.ProbeDimensions(thumbAbs); err != nil {
				log.Printf("queue: probing thumbnail dimensions for library item %d failed: %v", libID, err)
			} else {
				width, height = &w, &h
			}
			if err := m.libraryRepo.UpdateThumbnailTiers(parentCtx, libID, &tiers[0], &tiers[1], width, height); err != nil {
				log.Printf("queue: saving thumbnail derivatives for library item %d failed: %v", libID, err)
			} else if ghost != nil {
				// The ghost's placeholder tiers are superseded by the real ones.
				ghostthumb.RemoveTiers(m.imagesRoot, ghost.ThumbnailSmallPath, ghost.ThumbnailMediumPath)
			}
		}

		// Best-effort, fire-and-forget: if auto-on-download is enabled and
		// this thumbnail is still under the configured minDim, enhance it
		// now rather than waiting for the next scheduled sweep. Runs in its
		// own goroutine so a slow/unreachable upscaler never blocks this
		// download worker — same pattern as the metadata-embedding goroutine
		// below.
		m.tasks.Go(func() { m.maybeAutoEnhanceThumbnail(libID) })
	}

	// Best-effort: attach any tag override (currently only set by the
	// backup/library import flow — see ImportLibrary) now that the item has
	// an id to attach them to. Creates missing tag names rather than
	// silently dropping them, matching bulk-assign-tags' behavior.
	// The ghost already carries them (applied at creation, possibly edited since),
	// so a filled-in ghost is left alone; assignment is idempotent either way.
	if len(d.OverrideTags) > 0 && ghost == nil {
		if tagIDs, err := m.tagsRepo.GetOrCreateByNames(parentCtx, d.OverrideTags); err != nil {
			log.Printf("queue: creating override tags for %d failed: %v", id, err)
		} else if err := m.tagsRepo.SetForLibraryItem(parentCtx, libID, tagIDs); err != nil {
			log.Printf("queue: assigning override tags for %d failed: %v", id, err)
		}
	}

	// Best-effort: write the .nfo sidecar up front when "Generate NFO" was
	// requested at download time, same file writeNFO (library_handler.go)
	// produces for the manual "Generate NFO Now" action — fetched after the
	// override-tags block above so a batch item's tags are already settled.
	if d.GenerateNFO && d.DownloadType != "image" {
		tags, err := m.tagsRepo.TagsForLibraryItem(parentCtx, libID)
		if err != nil {
			log.Printf("queue: loading tags for nfo for %d failed: %v", id, err)
		} else if err := nfo.WriteSidecar(result.FinalPath, *libItem, tags); err != nil {
			log.Printf("queue: writing nfo for %d failed: %v", id, err)
		}
	}

	m.triggerJellyfinRefresh(parentCtx, d)

	// Best-effort: keep the file's own tags in sync with whatever overrides
	// were provided at request time, same call shape library_handler.go's
	// UpdateLibraryItem already uses on manual edits. Skipped entirely when
	// no override was set, so a plain download never pays the ffmpeg remux
	// cost.
	if d.DownloadType != "image" && (d.OverrideTitle != nil || d.OverrideArtistID != nil || d.OverrideYear != nil || d.OverrideSequenceNumber != nil || d.OverrideSeasonNumber != nil) {
		var overrideArtistName *string
		if d.OverrideArtistID != nil {
			if a, err := m.artistsRepo.Get(context.Background(), *d.OverrideArtistID); err == nil {
				overrideArtistName = &a.Name
			}
		}
		m.embedder.Submit(libID, result.FinalPath, metaembed.Request{Title: libItem.Title, Artist: overrideArtistName, Year: d.OverrideYear, SequenceNumber: d.OverrideSequenceNumber, SeasonNumber: d.OverrideSeasonNumber})
	}

	m.broadcaster.Broadcast(ws.Event{Type: ws.EventCompleted, Payload: ws.CompletedPayload{DownloadID: id, LibraryID: libID, Title: libItem.Title}})
}

// runImageDownload is the "image" download type's entire fetch step — a
// plain HTTP GET (imagefetch.Fetch) instead of a yt-dlp subprocess, with an
// optional format conversion per the image_convert_format setting. Returns
// the same downloader.RunResult shape runOne's yt-dlp path produces, so
// everything downstream (resolution/duration probing, buildLibraryItem,
// completeRedownload) keeps working unmodified regardless of which path
// produced it.
func (m *DownloadManager) runImageDownload(ctx context.Context, id int64, d *models.Download, destDir, filename string, forceOverwrite bool) (downloader.RunResult, error) {
	// Reuses the same ytdlp_proxy setting yt-dlp's own --proxy flag reads
	// (see downloader/args.go) — "" if unset, meaning a direct connection.
	proxy, _ := m.settingsRepo.Get(ctx, models.SettingYtdlpProxy)
	finalPath, _, err := imagefetch.Fetch(ctx, d.URL, destDir, filename, forceOverwrite, proxy, imagefetch.DownloadPolicy)
	if err != nil {
		return downloader.RunResult{}, err
	}

	// Mirrors api.ImageConvertFormat's default/validation (queue can't import
	// api — api already imports queue) — missing, unreadable, or corrupt
	// falls back to "jpg", matching the thumbnail-JPEG convention.
	format, settingErr := m.settingsRepo.Get(ctx, models.SettingImageConvertFormat)
	switch {
	case settingErr != nil:
		format = "jpg"
	case format != "original" && format != "jpg" && format != "png" && format != "webp":
		format = "jpg"
	}
	targetExt := "." + format
	if format != "original" && !strings.EqualFold(filepath.Ext(finalPath), targetExt) {
		// Convert into a distinctly-suffixed temp path first — never
		// ffmpeg src==dst. finalPath's extension-stripped basename can be
		// empty (e.g. a bare ".jpg"), which would otherwise make a naively
		// re-suffixed target collide with the source it's still reading.
		tmp := finalPath + ".converting" + targetExt
		if err := imageproc.ConvertImage(ctx, m.ytdlp.FFmpegPath, finalPath, tmp, format); err != nil {
			log.Printf("queue: converting image %d to %s failed: %v — keeping original format", id, format, err)
			os.Remove(tmp) // best-effort cleanup of any partial output
		} else {
			target := strings.TrimSuffix(finalPath, filepath.Ext(finalPath)) + targetExt
			// Never convert over a file that isn't ours (e.g. an existing
			// Cat.jpg next to the freshly fetched Cat.png).
			if target != finalPath {
				target = fsutil.UniquePath(target)
			}
			if err := os.Remove(finalPath); err != nil {
				log.Printf("queue: removing pre-conversion image %d failed: %v", id, err)
			}
			if err := os.Rename(tmp, target); err != nil {
				log.Printf("queue: finalizing converted image %d failed: %v", id, err)
			} else {
				finalPath = target
			}
		}
	}

	return downloader.RunResult{FinalPath: finalPath, Command: "GET " + d.URL}, nil
}

// titleFromURL derives a readable fallback title from an image URL's last
// path segment (extension stripped, percent-decoded) — used only for the
// "image" download type, which has no yt-dlp metadata fetch to pull a title
// from. Returns "" (falling through to the raw URL, same as the yt-dlp path)
// if the URL has no usable path segment.
func titleFromURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	base := path.Base(u.Path)
	if base == "" || base == "." || base == "/" {
		return ""
	}
	if decoded, err := url.PathUnescape(base); err == nil {
		base = decoded
	}
	return strings.TrimSuffix(base, filepath.Ext(base))
}

// parseResolution splits a "WxH" resolution string (as produced by
// importer.Probe) back into width/height. Used only by the image download
// path, where the thumbnail dimensions being recorded are the exact same
// file resolution was already probed from, so re-probing via
// imageproc.ProbeDimensions (JPEG-only) would be redundant and, for a
// non-JPEG convert format, unsupported.
func parseResolution(res string) (w, h int, ok bool) {
	if _, err := fmt.Sscanf(res, "%dx%d", &w, &h); err != nil {
		return 0, 0, false
	}
	return w, h, true
}

// maybeAutoEnhanceThumbnail is the best-effort background hook fired after
// every fresh (non-redownload) completion — no-ops quietly unless the
// auto-on-download setting is on and the item's thumbnail is currently
// eligible under the configured minDim. Errors are logged, never surfaced:
// this runs detached from the request/download lifecycle that triggered it.
func (m *DownloadManager) maybeAutoEnhanceThumbnail(libraryItemID int64) {
	deps := thumbnailenhance.Deps{
		SettingsRepo:  m.settingsRepo,
		LibraryRepo:   m.libraryRepo,
		HistoryRepo:   m.thumbnailEnhancementHistoryRepo,
		OriginalsRepo: m.thumbnailEnhancementOriginalsRepo,
		MediaRoot:     m.mediaRoot,
		ImagesRoot:    m.imagesRoot,
		FFmpegPath:    m.ytdlp.FFmpegPath,
		Broadcaster:   m.broadcaster,
	}
	if err := thumbnailenhance.MaybeAutoEnhanceOnDownload(m.rootCtx, deps, libraryItemID); err != nil {
		log.Printf("queue: auto-enhancing thumbnail for library item %d failed: %v", libraryItemID, err)
	}
}

// resolveFilename decides the final base filename for a download — and, if
// a FilenameTemplate produced a nested path, which extra directory segments
// need appending to destDir before it — given the literal Filename
// override, the newer FilenameTemplate, the legacy FilenamePrefix, and the
// effective title. Precedence: literal Filename always wins if set;
// otherwise FilenameTemplate (resolved against vars, which the caller only
// bothers to populate when a template is actually present) takes priority
// over FilenamePrefix (combined with effectiveTitle, e.g.
// "Matt.Iceberg.S01E01" + "My big moment" -> "Matt.Iceberg.S01E01 My big
// moment"); with none set, filename is "" and yt-dlp's own default naming
// applies, exactly as before either feature existed. Pure and side-effect
// free so it's easy to unit test directly, unlike the rest of runOne.
func resolveFilename(literal string, filenameTemplate, filenamePrefix *string, effectiveTitle string, vars nametemplate.Vars) (filename string, extraDirSegments []string) {
	if literal != "" {
		return literal, nil
	}
	if filenameTemplate != nil && strings.TrimSpace(*filenameTemplate) != "" {
		segments := nametemplate.Resolve(*filenameTemplate, vars)
		if len(segments) > 0 {
			return segments[len(segments)-1], segments[:len(segments)-1]
		}
		return "", nil
	}
	if filenamePrefix != nil && strings.TrimSpace(*filenamePrefix) != "" {
		return strings.TrimSpace(*filenamePrefix) + " " + effectiveTitle, nil
	}
	return "", nil
}

// filenameTemplateVars resolves everything a filename template's {variable}
// tokens can reference. Only called when d.FilenameTemplate is actually set
// (see runOne), so a plain download never pays for the extra artist/
// collection lookups here.
func (m *DownloadManager) filenameTemplateVars(ctx context.Context, d *models.Download, effectiveTitle string, meta *downloader.Metadata) nametemplate.Vars {
	vars := nametemplate.Vars{
		Title:    effectiveTitle,
		Uploader: meta.Uploader,
		Date:     meta.UploadDate,
		Season:   optionalIntString(d.OverrideSeasonNumber),
		Sequence: optionalIntString(d.OverrideSequenceNumber),
	}
	if d.OverrideYear != nil {
		vars.Year = strconv.Itoa(*d.OverrideYear)
	} else if len(meta.UploadDate) >= 4 {
		vars.Year = meta.UploadDate[:4]
	}
	if d.OverrideArtistID != nil {
		if a, err := m.artistsRepo.Get(ctx, *d.OverrideArtistID); err == nil {
			vars.Artist = a.Name
		}
	}
	if d.CollectionID != nil {
		if col, err := m.collectionsRepo.Get(ctx, *d.CollectionID); err == nil {
			vars.Collection = col.Name
		}
	}
	return vars
}

// optionalIntString formats an *int as a string, or "" if nil.
func optionalIntString(n *int) string {
	if n == nil {
		return ""
	}
	return strconv.Itoa(*n)
}

func (m *DownloadManager) buildLibraryItem(downloadID int64, d *models.Download, title string, meta *downloader.Metadata, finalPath string, resolution *string, duration int, sizeBytes *int64) *models.LibraryItem {
	// Stored as forward-slash paths regardless of host OS, since these are
	// read back purely to build URLs for the /media-files static route (the
	// frontend splits on "/") — filepath.Rel on Windows returns
	// backslash-separated paths, which would silently 404 as a URL.
	relPath := m.relMediaPath(finalPath)

	var thumbRelPtr *string
	var thumbAbs string
	if d.DownloadType == "image" {
		// The downloaded image doubles as its own thumbnail — there's no
		// separate sidecar to look for, so the tier-generation block below
		// just re-derives small/medium WebP tiers from the file itself,
		// exactly like collection covers/artist images already do.
		thumbAbs = finalPath
	} else {
		thumbAbs = thumbnailPathFor(finalPath)
		if thumbAbs != "" {
			// thumbnailPathFor only computes where yt-dlp's --convert-thumbnails
			// step *should* have written the jpg — confirm it's actually there
			// before storing the path, so a failed conversion (see the
			// exit-code leniency in runOne) never leaves the item pointing at a
			// thumbnail that doesn't exist. Falls back to no thumbnail; a later
			// manual "grab thumbnail" edit still works normally since that path
			// (FetchThumbnail) already checks for this itself.
			if _, err := os.Stat(thumbAbs); err != nil {
				thumbAbs = ""
			}
		}
	}
	if thumbAbs != "" {
		if rel, err := filepath.Rel(m.mediaRoot, thumbAbs); err == nil {
			relSlash := filepath.ToSlash(rel)
			thumbRelPtr = &relSlash
		}
	}

	uploader := meta.Uploader
	videoID := meta.ID
	description := meta.Description
	mediaType := d.DownloadType

	return &models.LibraryItem{
		DownloadID:     &downloadID,
		Title:          title,
		Filename:       filepath.Base(finalPath),
		Path:           relPath,
		CollectionID:   d.CollectionID,
		Folder:         d.Folder,
		OriginalURL:    &d.URL,
		VideoID:        &videoID,
		Uploader:       &uploader,
		Duration:       &duration,
		Resolution:     resolution,
		MediaType:      &mediaType,
		Thumbnail:      thumbRelPtr,
		Description:    &description,
		ArtistID:       d.OverrideArtistID,
		ReleaseYear:    d.OverrideYear,
		SequenceNumber: d.OverrideSequenceNumber,
		SeasonNumber:   d.OverrideSeasonNumber,
		Status:         "completed",
		FileSizeBytes:  sizeBytes,
	}
}

// redownloadOverwritableFields is the allowlist of values OverwriteFields
// may contain — must match the allowlist RedownloadLibraryItemFromURL
// validates against in library_handler.go.
var redownloadOverwritableFields = map[string]bool{
	"title": true, "uploader": true, "description": true,
	"thumbnail": true, "resolution": true, "duration": true,
}

// completeRedownload is runOne's completion path when d.TargetLibraryItemID
// is set: it swaps the freshly-downloaded scratch file over the existing
// library item's file and updates that item in place (via
// LibraryRepo.ApplyRedownload), instead of the normal path's
// buildLibraryItem/Create. result.FinalPath is wherever the scratch
// download actually landed (inside TrimTmpDir, per runOne's job-building
// branch); effectiveRoot is the already-resolved collection root the
// item's real folder lives under.
//
// The swap happens before MarkCompleted/history are recorded — a failure
// (locked file, disk full) routes through finishError instead, so the
// download row never claims "completed" for a redownload whose file was
// never actually swapped into place, and no duplicate "completed" +
// "failed" history pair results.
func (m *DownloadManager) completeRedownload(parentCtx, runCtx context.Context, downloadID int64, d *models.Download, effectiveTitle string, meta *downloader.Metadata, result downloader.RunResult, resolution *string, duration int, sizeBytes *int64, effectiveRoot string) {
	targetID := *d.TargetLibraryItemID

	// Swapping the file in is a write to the item's media file, so it waits for
	// any in-flight metadata remux of the old file (a worker, not a request, so
	// blocking is fine) and keeps user operations (move, trim, delete) out until
	// the row points at the new file. The follow-up embed below is only queued
	// (Submit never blocks); it runs once this lock is released.
	m.itemLocks.Lock(targetID)
	defer m.itemLocks.Unlock(targetID)

	fail := func(msg string) {
		m.finishError(parentCtx, runCtx, downloadID, d.URL, msg, result.StdoutTail, result.StderrTail)
		os.Remove(result.FinalPath)
		os.Remove(thumbnailPathFor(result.FinalPath))
	}

	target, err := m.libraryRepo.Get(parentCtx, targetID)
	if err != nil {
		fail("loading target library item: " + err.Error())
		return
	}

	destDir, err := pathsafe.ResolveUnderRoot(effectiveRoot, target.Folder)
	if err != nil {
		fail("resolving target folder: " + err.Error())
		return
	}

	newExt := filepath.Ext(result.FinalPath)
	// target.Filename is "" for a ghost item being filled in for the first
	// time (no prior file to derive a base name from) — fall back to the
	// effective title, same source a fresh download's own filename would
	// come from.
	base := effectiveTitle
	if target.Filename != "" {
		base = strings.TrimSuffix(target.Filename, filepath.Ext(target.Filename))
	}
	newFilename := fsutil.SanitizeFilename(base + newExt)
	newPath := filepath.Join(destDir, newFilename)
	// Replacing the item's own current file is the point of a same-name
	// redownload; anything else already sitting at newPath belongs to
	// someone else and must survive, so take a numbered name instead.
	if _, statErr := os.Lstat(newPath); statErr == nil {
		ownPath := ""
		if target.Path != "" {
			ownPath = filepath.Join(m.mediaRoot, filepath.FromSlash(target.Path))
		}
		if filepath.Clean(newPath) != filepath.Clean(ownPath) {
			newPath = fsutil.UniquePath(newPath)
			newFilename = filepath.Base(newPath)
		}
	}
	tmpThumbPath := thumbnailPathFor(result.FinalPath)
	oldAbsPath := ""
	if target.Path != "" {
		oldAbsPath = filepath.Join(m.mediaRoot, filepath.FromSlash(target.Path))
	}
	samePath := oldAbsPath != "" && filepath.Clean(oldAbsPath) == filepath.Clean(newPath)

	if err := os.Rename(result.FinalPath, newPath); err != nil {
		fail("replacing file: " + err.Error())
		return
	}

	overwrite := make(map[string]bool, len(d.OverwriteFields))
	for _, f := range d.OverwriteFields {
		if redownloadOverwritableFields[f] {
			overwrite[f] = true
		}
	}

	relPath := filepath.ToSlash(newPath)
	if rel, err := filepath.Rel(m.mediaRoot, newPath); err == nil {
		relPath = filepath.ToSlash(rel)
	}
	params := repository.ApplyRedownloadParams{
		Filename:    newFilename,
		Path:        relPath,
		OriginalURL: d.URL,
		VideoID:     meta.ID,
	}
	if sizeBytes != nil {
		params.FileSizeBytes = *sizeBytes
	}
	if overwrite["duration"] {
		params.Duration = &duration
	}
	if overwrite["resolution"] {
		params.Resolution = resolution
	}
	if overwrite["title"] {
		params.Title = &effectiveTitle
	}
	if overwrite["uploader"] {
		uploader := meta.Uploader
		params.Uploader = &uploader
	}
	if overwrite["description"] {
		description := meta.Description
		params.Description = &description
	}
	applyCtx, applyDone := bgtasks.CompletionContext(parentCtx)
	applyErr := db.RetryBusy(applyCtx, func() error { return m.libraryRepo.ApplyRedownload(applyCtx, targetID, params) })
	applyDone()
	if err := applyErr; err != nil {
		log.Printf("queue: applying redownload for library item %d failed: %v", targetID, err)
		if samePath {
			// The old content was already replaced in place; nothing to restore.
			fail("updating library item after replacing the file: " + err.Error())
		} else {
			// The old file is still intact and the row still points at it:
			// drop the new one.
			os.Remove(newPath)
			fail("updating library item: " + err.Error())
		}
		return
	}

	// Extension or name changed (source now merges to a different container,
	// or a clash got a numbered suffix) — the old file is orphaned at its old
	// name; best-effort cleanup. oldAbsPath == "" means there was no prior
	// file (the ghost-fill-in case). Only now, after the row points at the
	// new file.
	if newFilename != target.Filename && oldAbsPath != "" && !samePath {
		if err := os.Remove(oldAbsPath); err != nil && !os.IsNotExist(err) {
			log.Printf("queue: removing stale redownloaded file %s failed: %v", oldAbsPath, err)
		}
	}

	termCtx, termDone := bgtasks.CompletionContext(parentCtx)
	if err := db.RetryBusy(termCtx, func() error {
		return m.downloadsRepo.MarkCompleted(termCtx, downloadID, 0, resolution, result.StdoutTail, result.StderrTail)
	}); err != nil {
		log.Printf("queue: mark completed failed for %d: %v", downloadID, err)
	}
	if _, err := db.RetryBusyValue(termCtx, func() (int64, error) {
		return m.historyRepo.Create(termCtx, &downloadID, d.URL, "completed", nil)
	}); err != nil {
		log.Printf("queue: recording history for %d failed: %v", downloadID, err)
	}
	termDone()

	// Thumbnail: swap + regenerate derivative tiers if explicitly requested,
	// or if the item has no thumbnail at all yet (most commonly a ghost item
	// being filled in for the first time — nothing to preserve, so there's
	// no reason to discard the one yt-dlp already fetched unconditionally,
	// see BuildArgs' --write-thumbnail). Otherwise it's discarded unused and
	// the item's existing thumbnail/tiers are left completely alone.
	hasExistingThumbnail := target.Thumbnail != nil || target.ThumbnailSmallPath != nil
	if d.DownloadType == "image" {
		// The redownloaded image doubles as its own thumbnail — same
		// convention as the fresh-download path (buildLibraryItem) — so
		// swap/regenerate unconditionally rather than looking for a separate
		// yt-dlp-fetched sidecar (tmpThumbPath), which doesn't exist here.
		var oldThumbAbs string
		if target.Thumbnail != nil {
			oldThumbAbs = filepath.Join(m.mediaRoot, filepath.FromSlash(*target.Thumbnail))
		}
		if oldThumbAbs != "" && oldThumbAbs != newPath {
			if err := os.Remove(oldThumbAbs); err != nil && !os.IsNotExist(err) {
				log.Printf("queue: removing stale thumbnail %s failed: %v", oldThumbAbs, err)
			}
		}
		if err := thumbnailenhance.DeleteOriginal(parentCtx, thumbnailenhance.Deps{OriginalsRepo: m.thumbnailEnhancementOriginalsRepo, ImagesRoot: m.imagesRoot}, targetID); err != nil && !errors.Is(err, repository.ErrNotFound) {
			log.Printf("queue: clearing stale AI-enhancement backup for library item %d failed: %v", targetID, err)
		}
		if err := m.libraryRepo.UpdateThumbnail(parentCtx, targetID, &relPath); err != nil {
			log.Printf("queue: updating thumbnail path for library item %d failed: %v", targetID, err)
		}
		if tiers, err := imageproc.GenerateTiersFromPath(parentCtx, m.ytdlp.FFmpegPath, m.imagesRoot, "library", targetID, newPath, libraryThumbnailTiers); err != nil {
			log.Printf("queue: generating thumbnail derivatives for library item %d failed: %v", targetID, err)
		} else {
			var width, height *int
			if resolution != nil {
				if w, h, ok := parseResolution(*resolution); ok {
					width, height = &w, &h
				}
			}
			if err := m.libraryRepo.UpdateThumbnailTiers(parentCtx, targetID, &tiers[0], &tiers[1], width, height); err != nil {
				log.Printf("queue: saving thumbnail derivatives for library item %d failed: %v", targetID, err)
			}
		}
	} else if overwrite["thumbnail"] || !hasExistingThumbnail {
		if _, err := os.Stat(tmpThumbPath); err == nil {
			newThumbPath := thumbnailPathFor(newPath)
			var oldThumbAbs string
			if target.Thumbnail != nil {
				oldThumbAbs = filepath.Join(m.mediaRoot, filepath.FromSlash(*target.Thumbnail))
			}
			if err := os.Rename(tmpThumbPath, newThumbPath); err != nil {
				log.Printf("queue: swapping thumbnail for library item %d failed: %v", targetID, err)
			} else {
				if oldThumbAbs != "" && oldThumbAbs != newThumbPath {
					if err := os.Remove(oldThumbAbs); err != nil && !os.IsNotExist(err) {
						log.Printf("queue: removing stale thumbnail %s failed: %v", oldThumbAbs, err)
					}
				}
				// The redownloaded thumbnail just overwrote whatever was
				// there — any AI-enhancement backup on file now describes a
				// "before" image unrelated to this new thumbnail. Clear it
				// so Compare/Revert don't act on stale data (best-effort;
				// ErrNotFound just means this item was never enhanced).
				if err := thumbnailenhance.DeleteOriginal(parentCtx, thumbnailenhance.Deps{OriginalsRepo: m.thumbnailEnhancementOriginalsRepo, ImagesRoot: m.imagesRoot}, targetID); err != nil && !errors.Is(err, repository.ErrNotFound) {
					log.Printf("queue: clearing stale AI-enhancement backup for library item %d failed: %v", targetID, err)
				}
				thumbRel := filepath.ToSlash(newThumbPath)
				if rel, err := filepath.Rel(m.mediaRoot, newThumbPath); err == nil {
					thumbRel = filepath.ToSlash(rel)
				}
				if err := m.libraryRepo.UpdateThumbnail(parentCtx, targetID, &thumbRel); err != nil {
					log.Printf("queue: updating thumbnail path for library item %d failed: %v", targetID, err)
				}
				if tiers, err := imageproc.GenerateTiersFromPath(parentCtx, m.ytdlp.FFmpegPath, m.imagesRoot, "library", targetID, newThumbPath, libraryThumbnailTiers); err != nil {
					log.Printf("queue: generating thumbnail derivatives for library item %d failed: %v", targetID, err)
				} else {
					var width, height *int
					if w, h, err := imageproc.ProbeDimensions(newThumbPath); err != nil {
						log.Printf("queue: probing thumbnail dimensions for library item %d failed: %v", targetID, err)
					} else {
						width, height = &w, &h
					}
					if err := m.libraryRepo.UpdateThumbnailTiers(parentCtx, targetID, &tiers[0], &tiers[1], width, height); err != nil {
						log.Printf("queue: saving thumbnail derivatives for library item %d failed: %v", targetID, err)
					}
				}
			}
		}
	} else {
		os.Remove(tmpThumbPath)
	}

	updated, err := m.libraryRepo.Get(parentCtx, targetID)
	if err != nil {
		log.Printf("queue: re-fetching library item %d after redownload failed: %v", targetID, err)
		updated = target
	}

	// Best-effort: regenerate the .nfo sidecar if it's turned on for this
	// item, so it doesn't go stale with pre-redownload duration/resolution.
	if updated.GenerateNFO && d.DownloadType != "image" {
		tags, err := m.tagsRepo.TagsForLibraryItem(parentCtx, targetID)
		if err != nil {
			log.Printf("queue: loading tags for nfo for library item %d failed: %v", targetID, err)
		} else if err := nfo.WriteSidecar(newPath, *updated, tags); err != nil {
			log.Printf("queue: writing nfo for library item %d failed: %v", targetID, err)
		}
	}

	// Always re-embed the file's own container tags from the item's final
	// (post-update) values — BuildArgs' --embed-metadata is unconditional,
	// so the freshly-fetched source's title/uploader are already baked in
	// regardless of what was checked; this keeps the file's own tags
	// consistent with the DB record even when a field was left unchecked.
	// Skipped for images: -c copy -metadata muxing is meaningless (and can
	// error) against a JPEG/PNG/WebP file.
	var artistName *string
	if updated.ArtistID != nil {
		if a, err := m.artistsRepo.Get(parentCtx, *updated.ArtistID); err == nil {
			artistName = &a.Name
		}
	}
	if d.DownloadType == "image" {
		m.triggerJellyfinRefresh(parentCtx, d)
		m.broadcaster.Broadcast(ws.Event{Type: ws.EventCompleted, Payload: ws.CompletedPayload{DownloadID: downloadID, LibraryID: targetID, Title: updated.Title}})
		return
	}
	m.embedder.Submit(targetID, newPath, metaembed.Request{Title: updated.Title, Artist: artistName, Year: updated.ReleaseYear, SequenceNumber: updated.SequenceNumber, SeasonNumber: updated.SeasonNumber})

	m.triggerJellyfinRefresh(parentCtx, d)

	m.broadcaster.Broadcast(ws.Event{Type: ws.EventCompleted, Payload: ws.CompletedPayload{DownloadID: downloadID, LibraryID: targetID, Title: updated.Title}})
}

// ghostRun is the ghost library row a running download is filling in.
// createdByRun distinguishes a ghost this run made (removed again on a user
// cancel) from one that already existed (Add item, subscription, or kept
// after an earlier failed run; never removed by a cancel).
type ghostRun struct {
	libraryID    int64
	createdByRun bool
}

// ghostThumbnailTimeout bounds the best-effort thumbnail fetch so a slow
// image host can't hold up the start of the real download.
const ghostThumbnailTimeout = 20 * time.Second

// ensureGhost makes sure a library row exists for download id before the
// file download starts: it reuses d.GhostLibraryItemID when that row still
// exists and is still a ghost (a retried download), otherwise creates a new
// ghost from the fetched metadata and the download's overrides. Every failure
// is logged and swallowed — without a ghost the download simply behaves as
// it did before (a library item is created when the file lands). This is
// deliberately separate from completeRedownload/TargetLibraryItemID: the
// ghost goes through the normal filename/template handling.
func (m *DownloadManager) ensureGhost(ctx context.Context, id int64, d *models.Download, title string, meta *downloader.Metadata) {
	if ctx.Err() != nil {
		return
	}
	if d.GhostLibraryItemID != nil {
		if existing, err := m.libraryRepo.Get(ctx, *d.GhostLibraryItemID); err == nil && existing.Status == "ghost" {
			m.setRunGhost(id, ghostRun{libraryID: existing.ID})
			if err := m.downloadsRepo.SetGhostLibraryItem(ctx, id, existing.ID); err != nil {
				log.Printf("queue: recording ghost item for download %d failed: %v", id, err)
			}
			return
		}
	}

	uploader, videoID, description := meta.Uploader, meta.ID, meta.Description
	duration := int(meta.Duration)
	mediaType := d.DownloadType
	item := &models.LibraryItem{
		DownloadID:     &id,
		Title:          title,
		CollectionID:   d.CollectionID,
		Folder:         d.Folder,
		OriginalURL:    &d.URL,
		VideoID:        &videoID,
		Uploader:       &uploader,
		Duration:       &duration,
		MediaType:      &mediaType,
		Description:    &description,
		ArtistID:       d.OverrideArtistID,
		ReleaseYear:    d.OverrideYear,
		SequenceNumber: d.OverrideSequenceNumber,
		SeasonNumber:   d.OverrideSeasonNumber,
		GenerateNFO:    d.GenerateNFO,
		Status:         "ghost",
	}
	libID, err := m.libraryRepo.Create(ctx, item)
	if err != nil {
		log.Printf("queue: creating ghost item for download %d failed: %v", id, err)
		return
	}
	m.setRunGhost(id, ghostRun{libraryID: libID, createdByRun: true})
	if err := m.downloadsRepo.SetGhostLibraryItem(ctx, id, libID); err != nil {
		log.Printf("queue: recording ghost item for download %d failed: %v", id, err)
	}

	if len(d.OverrideTags) > 0 {
		if tagIDs, err := m.tagsRepo.GetOrCreateByNames(ctx, d.OverrideTags); err != nil {
			log.Printf("queue: creating override tags for ghost %d failed: %v", libID, err)
		} else if err := m.tagsRepo.SetForLibraryItem(ctx, libID, tagIDs); err != nil {
			log.Printf("queue: assigning override tags to ghost %d failed: %v", libID, err)
		}
	}

	if meta.Thumbnail != "" {
		proxy, _ := m.settingsRepo.Get(ctx, models.SettingYtdlpProxy)
		tctx, cancel := context.WithTimeout(ctx, ghostThumbnailTimeout)
		ghostthumb.Generate(tctx, m.libraryRepo, m.imagesRoot, m.ytdlp.FFmpegPath, libID, func(c context.Context, dir string) (string, error) {
			return fetchRemoteThumbnail(c, meta.Thumbnail, dir, proxy)
		})
		cancel()
	}

	m.broadcaster.Broadcast(ws.Event{Type: ws.EventLibraryChanged, Payload: ws.LibraryChangedPayload{LibraryID: libID, Reason: "ghost_created"}})
}

// fetchRemoteThumbnail fetches a thumbnail URL that came from remote metadata
// (the page being downloaded chose it), so it is untrusted: private/loopback/
// link-local destinations are refused and the size is capped. The thumbnail is
// best-effort — the caller (ghostthumb.Generate) logs the returned error and
// the download carries on. A refusal returns a URL-free error so the log line
// can't leak a query-string secret.
func fetchRemoteThumbnail(ctx context.Context, thumbURL, dir, proxy string) (string, error) {
	p, _, err := imagefetch.Fetch(ctx, thumbURL, dir, "thumb", true, proxy, imagefetch.ThumbnailPolicy)
	if errors.Is(err, imagefetch.ErrBlockedAddress) {
		return "", errors.New("thumbnail URL refused: it points at a private or non-public address")
	}
	return p, err
}

func (m *DownloadManager) setRunGhost(id int64, g ghostRun) {
	m.mu.Lock()
	m.runGhosts[id] = g
	m.mu.Unlock()
}

func (m *DownloadManager) runGhost(id int64) (ghostRun, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	g, ok := m.runGhosts[id]
	return g, ok
}

// fillOrCreateLibraryItem turns the finished download's libItem into the
// library row: the run's ghost is filled in place (same id) when there is
// one, otherwise — no ghost, or it vanished meanwhile — a new row is created
// so the file is never lost. The returned ghost snapshot (pre-fill) is nil
// when a new row was created.
func (m *DownloadManager) fillOrCreateLibraryItem(ctx context.Context, downloadID int64, libItem *models.LibraryItem) (int64, *models.LibraryItem, error) {
	if g, ok := m.runGhost(downloadID); ok {
		before, err := m.libraryRepo.Get(ctx, g.libraryID)
		if err == nil {
			// A ghost this run merely reused keeps its own (possibly edited)
			// title/uploader/description; one it created takes the download's.
			err = db.RetryBusy(ctx, func() error {
				return m.libraryRepo.CompleteGhostFromDownload(ctx, g.libraryID, libItem, !g.createdByRun)
			})
		}
		if err == nil {
			if !g.createdByRun {
				// libItem now mirrors the row, so the NFO, metadata embedding
				// and notification below use what the item really holds.
				libItem.Title, libItem.Uploader, libItem.Description = before.Title, before.Uploader, before.Description
			}
			return g.libraryID, before, nil
		}
		log.Printf("queue: filling ghost item %d for download %d failed (%v) — creating a new item instead", g.libraryID, downloadID, err)
	}
	libID, err := db.RetryBusyValue(ctx, func() (int64, error) { return m.libraryRepo.Create(ctx, libItem) })
	return libID, nil, err
}

// removeRunGhost deletes the ghost a run created itself (plus its derivative
// files) after a user cancel. A ghost that existed before the run is kept,
// and so is anything no longer a ghost. Deleting an already-deleted row (a
// library delete cancelled this download) is not an error. Skipped while the
// server is shutting down (parentCtx done): that leaves the download to be
// marked interrupted on the next start, ghost intact.
func (m *DownloadManager) removeRunGhost(parentCtx context.Context, id int64) {
	g, ok := m.runGhost(id)
	if !ok || !g.createdByRun || parentCtx.Err() != nil {
		return
	}
	item, err := m.libraryRepo.Get(parentCtx, g.libraryID)
	if err != nil {
		if !errors.Is(err, repository.ErrNotFound) {
			log.Printf("queue: loading ghost item %d for cleanup failed: %v", g.libraryID, err)
		}
		return
	}
	if item.Status != "ghost" {
		return
	}
	if err := m.libraryRepo.Delete(parentCtx, g.libraryID); err != nil {
		if !errors.Is(err, repository.ErrNotFound) {
			log.Printf("queue: removing ghost item %d failed: %v", g.libraryID, err)
		}
		return
	}
	ghostthumb.RemoveItemDir(m.imagesRoot, g.libraryID)
	m.broadcaster.Broadcast(ws.Event{Type: ws.EventLibraryChanged, Payload: ws.LibraryChangedPayload{LibraryID: g.libraryID, Reason: "ghost_removed"}})
}

// triggerJellyfinRefresh schedules a debounced Jellyfin rescan for a just-
// completed download, per the jellyfin_refresh_mode setting — "entire"
// debounces a full-library refresh, "specific" debounces a refresh scoped
// to d's collection's linked Jellyfin library (skipped entirely if the
// collection has none set, or the download is uncategorized: there's
// nothing to target, and silently falling back to a full refresh would
// violate the user's explicit "specific" choice), "none" (or Jellyfin not
// enabled) does nothing. Reads settings directly rather than via the api
// package's JellyfinEnabled helper, since api already imports queue and a
// reverse import would cycle.
func (m *DownloadManager) triggerJellyfinRefresh(ctx context.Context, d *models.Download) {
	enabledRaw, err := m.settingsRepo.Get(ctx, models.SettingJellyfinEnabled)
	if err != nil || enabledRaw != "true" {
		return
	}
	mode, err := m.settingsRepo.Get(ctx, models.SettingJellyfinRefreshMode)
	if err != nil {
		mode = "none"
	}

	switch mode {
	case "entire":
		m.jellyfinDebounce.Trigger("")
	case "specific":
		if d.CollectionID == nil {
			return
		}
		collection, err := m.collectionsRepo.Get(ctx, *d.CollectionID)
		if err != nil || collection.JellyfinLibrary == nil || *collection.JellyfinLibrary == "" {
			return
		}
		m.jellyfinDebounce.Trigger(*collection.JellyfinLibrary)
	}
}

// doJellyfinRefresh is the Debouncer callback — it fires after the debounce
// window closes, so it re-reads the URL/API key fresh rather than trusting
// whatever was current when triggerJellyfinRefresh ran. Errors are only
// logged: this is a best-effort background trigger, not a user-facing
// action — the manual "Rescan Library Now" button is the path that surfaces
// failures directly.
func (m *DownloadManager) doJellyfinRefresh(target string) {
	ctx := context.Background()
	baseURL, err := m.settingsRepo.Get(ctx, models.SettingJellyfinURL)
	if err != nil || baseURL == "" {
		return
	}
	apiKey, err := m.settingsRepo.Get(ctx, models.SettingJellyfinAPIKey)
	if err != nil || apiKey == "" {
		return
	}

	if target == "" {
		if err := m.jellyfinClient.RefreshFull(ctx, baseURL, apiKey); err != nil {
			log.Printf("queue: jellyfin full refresh failed: %v", err)
		}
		return
	}
	if err := m.jellyfinClient.RefreshItem(ctx, baseURL, apiKey, target); err != nil {
		log.Printf("queue: jellyfin refresh of library %s failed: %v", target, err)
	}
}

// thumbnailPathFor guesses the thumbnail path written alongside finalPath.
// --convert-thumbnails jpg (see downloader.BuildArgs) means it always has a
// .jpg extension and the same base name as the media file.
func thumbnailPathFor(finalPath string) string {
	if finalPath == "" {
		return ""
	}
	ext := filepath.Ext(finalPath)
	base := strings.TrimSuffix(finalPath, ext)
	return base + ".jpg"
}

// orphanThumbnailExts are the original-format thumbnail extensions yt-dlp's
// --write-thumbnail can leave behind when --convert-thumbnails fails. ".jpg"
// is deliberately absent: that is the wanted thumbnail.
var orphanThumbnailExts = []string{".webp", ".avif", ".png", ".jpeg", ".gif", ".bmp", ".heic"}

// alreadyDownloadedMarker is what yt-dlp prints (and then exits 0) when the
// output path already exists and it therefore skipped the download.
const alreadyDownloadedMarker = "has already been downloaded"

// maxNameClashRetries bounds the re-runs under a disambiguated name.
const maxNameClashRetries = 5

// relMediaPath is the forward-slash, mediaRoot-relative form library.path stores.
func (m *DownloadManager) relMediaPath(finalPath string) string {
	if rel, err := filepath.Rel(m.mediaRoot, finalPath); err == nil {
		return filepath.ToSlash(rel)
	}
	return filepath.ToSlash(finalPath)
}

// runGhostID is the id of the ghost row this run created or reuses, 0 if none.
func (m *DownloadManager) runGhostID(downloadID int64) int64 {
	if g, ok := m.runGhost(downloadID); ok {
		return g.libraryID
	}
	return 0
}

// pathClaimedByOther reports whether another library row owns finalPath. A
// failed lookup counts as claimed: callers use it to decide what is safe to delete.
func (m *DownloadManager) pathClaimedByOther(ctx context.Context, finalPath string, ghostID int64) bool {
	claimed, err := m.libraryRepo.PathClaimedByOther(ctx, m.relMediaPath(finalPath), ghostID)
	if err != nil {
		log.Printf("queue: checking whether %s belongs to another item failed: %v", finalPath, err)
		return true
	}
	return claimed
}

// runYtDlp runs yt-dlp for job and validates the outcome: a start failure, or
// a non-zero exit without a written output file, ends the download through
// finishError (ok is false). A non-zero exit with the output file present is
// tolerated, see below; the result keeps its ExitCode so the caller can clean up.
func (m *DownloadManager) runYtDlp(parentCtx, runCtx context.Context, id int64, d *models.Download, job downloader.DownloadJob) (downloader.RunResult, bool) {
	result, runErr := m.ytdlp.Run(runCtx, job, func(ev downloader.ProgressEvent) {
		m.onProgress(id, ev)
	})
	partials := partialFiles{dir: job.DestDir, destinations: result.Destinations}
	if runErr != nil {
		m.finishErrorKeepingPartials(parentCtx, runCtx, id, d.URL, runErr.Error(), "", "", partials)
		return result, false
	}
	if result.ExitCode != 0 {
		// A non-zero exit doesn't necessarily mean the video itself failed —
		// --write-thumbnail/--convert-thumbnails runs as a postprocessing
		// step inside the same yt-dlp invocation (args.go), and a thumbnail
		// yt-dlp can't convert (e.g. an AVIF thumbnail on a minimal ffmpeg
		// build with no AVIF decoder) makes yt-dlp exit non-zero even though
		// the video already finished downloading and moving into place.
		// result.FinalPath is only ever populated from the "after_move:"
		// print hook, which only fires once that move has actually
		// happened — trust that signal (and confirm the file is really
		// there) instead of discarding a good download.
		if !outputFileExists(result.FinalPath) {
			m.finishErrorKeepingPartials(parentCtx, runCtx, id, d.URL, fmt.Sprintf("yt-dlp exited with code %d", result.ExitCode), result.StdoutTail, result.StderrTail, partials)
			return result, false
		}
		log.Printf("queue: download %d: yt-dlp exited with code %d but %s was written successfully — continuing, likely a postprocessing failure (e.g. thumbnail conversion)", id, result.ExitCode, result.FinalPath)
	}
	return result, true
}

// disambiguatedName is the file name (without extension) to retry under when
// the previous attempt's output belongs to another item. base is the explicit
// name, or for default naming the stem of the clashing file. Default naming
// tries "<stem> [<video id>]" first; every other attempt numbers from (2).
func disambiguatedName(base string, defaultNaming bool, videoID string, attempt int) string {
	if defaultNaming && videoID != "" {
		if attempt == 1 {
			return base + " [" + videoID + "]"
		}
		return fmt.Sprintf("%s (%d)", base, attempt)
	}
	return fmt.Sprintf("%s (%d)", base, attempt+1)
}

// resolveNameClash checks, once yt-dlp has reported its output path, that no
// other library row owns that file. If one does, yt-dlp skipped the download
// ("already been downloaded"), so it is re-run under a disambiguated name
// until the output is free (a name not on disk makes it download for real).
// The clashing file and its sidecars are never touched. A file that exists but
// no row claims is not a clash: it is adopted as before. Returns ok=false after
// ending the download through finishError.
func (m *DownloadManager) resolveNameClash(parentCtx, runCtx context.Context, id int64, d *models.Download, job downloader.DownloadJob, meta *downloader.Metadata, result downloader.RunResult) (downloader.RunResult, bool) {
	ghostID := m.runGhostID(id)
	defaultNaming := job.Filename == ""
	base := job.Filename
	for attempt := 0; outputFileExists(result.FinalPath); attempt++ {
		claimed, err := m.libraryRepo.PathClaimedByOther(runCtx, m.relMediaPath(result.FinalPath), ghostID)
		if err != nil {
			m.finishError(parentCtx, runCtx, id, d.URL, "checking for an existing file with the same name: "+err.Error(), result.StdoutTail, result.StderrTail)
			return result, false
		}
		if !claimed {
			break
		}
		if attempt == maxNameClashRetries {
			m.finishError(parentCtx, runCtx, id, d.URL, fmt.Sprintf("another library item already uses the file name %q and no free name was found after %d attempts", filepath.Base(result.FinalPath), maxNameClashRetries), result.StdoutTail, result.StderrTail)
			return result, false
		}
		if attempt == 0 && defaultNaming {
			base = strings.TrimSuffix(filepath.Base(result.FinalPath), filepath.Ext(result.FinalPath))
		}
		job.Filename = fsutil.SanitizeFilename(disambiguatedName(base, defaultNaming, meta.ID, attempt+1))
		log.Printf("queue: download %d: %s belongs to another library item — retrying as %q", id, result.FinalPath, job.Filename)
		var ok bool
		if result, ok = m.runYtDlp(parentCtx, runCtx, id, d, job); !ok {
			return result, false
		}
	}
	return result, true
}

// outputFileExists reports whether yt-dlp's reported output path is a real file.
func outputFileExists(path string) bool {
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

// cleanupOrphanedThumbnailArtifacts removes the original-format thumbnail
// (e.g. .avif/.webp) yt-dlp's --write-thumbnail step downloaded but
// --convert-thumbnails then failed to turn into the .jpg Packrat actually
// uses (see the exit-code leniency in runOne). Only the known artifacts at
// exactly base+ext are removed — never a glob, so sibling files that merely
// share a prefix (other items' media, .nfo, subtitles, "Name [Live]" names)
// are never touched. Best-effort.
func cleanupOrphanedThumbnailArtifacts(finalPath string) {
	base := strings.TrimSuffix(finalPath, filepath.Ext(finalPath))
	for _, ext := range orphanThumbnailExts {
		p := base + ext
		if p == finalPath {
			continue
		}
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			log.Printf("queue: removing orphaned thumbnail artifact %s failed: %v", p, err)
		}
	}
}

// classifyRunCtxErr distinguishes why runCtx ended, so finishError can record the real cause
// instead of always reporting a plain failure — a configured timeout firing is a system-triggered
// stop (not requested by the user), while an explicit Cancel() call is user-initiated.
func classifyRunCtxErr(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case err != nil:
		return "cancelled"
	default:
		return ""
	}
}

// finishError handles any error that ends a download's run, distinguishing a configured timeout
// and user-initiated cancellation (runCtx was cancelled) from a genuine failure so the stored
// status/broadcast reflects the real cause rather than always reporting "failed" —
// MarkCancelled/MarkFailed use parentCtx since runCtx is already done by the time this runs.
func (m *DownloadManager) finishError(parentCtx, runCtx context.Context, id int64, url, errMsg, stdoutTail, stderrTail string) {
	m.finishErrorKeepingPartials(parentCtx, runCtx, id, url, errMsg, stdoutTail, stderrTail, partialFiles{})
}

// partialFiles describes the files a yt-dlp run was writing: dir is the
// download's destination directory and destinations the paths it reported.
// The zero value means "nothing known", which cleans up nothing.
type partialFiles struct {
	dir          string
	destinations []string
}

// finishErrorKeepingPartials is finishError for a yt-dlp run. A failed or timed-out
// run keeps its partial files (a retry resumes from the .part file); only a user
// cancel abandons the work, so only that branch removes them. A cancel caused by
// the server shutting down (parentCtx done) keeps them too, like the ghost.
func (m *DownloadManager) finishErrorKeepingPartials(parentCtx, runCtx context.Context, id int64, url, errMsg, stdoutTail, stderrTail string, partials partialFiles) {
	// The outcome is recorded with a context that survives shutdown (the
	// parent is cancelled by then), bounded so a wedged DB can't stall it.
	ctx, done := bgtasks.TerminalContext(parentCtx)
	defer done()

	switch classifyRunCtxErr(runCtx.Err()) {
	case "timeout":
		timeoutMsg := "download exceeded the configured time limit and was stopped"
		if err := m.downloadsRepo.MarkFailed(ctx, id, -1, timeoutMsg, stdoutTail, stderrTail); err != nil {
			log.Printf("queue: mark failed failed for %d: %v", id, err)
		}
		if _, err := m.historyRepo.Create(ctx, &id, url, "failed", &timeoutMsg); err != nil {
			log.Printf("queue: recording history for %d failed: %v", id, err)
		}
		m.broadcaster.Broadcast(ws.Event{Type: ws.EventFailed, Payload: ws.FailedPayload{DownloadID: id, Status: "failed", Error: timeoutMsg}})
		return
	case "cancelled":
		if parentCtx.Err() != nil {
			// Server shutdown, not a user cancel: leave the row and its partial
			// files alone — startup recovery marks it interrupted and records
			// the history entry, and a retry resumes from the .part file.
			return
		}
		removePartialFiles(partials)
		m.removeRunGhost(ctx, id)
		if err := m.downloadsRepo.MarkCancelled(ctx, id); err != nil {
			log.Printf("queue: mark cancelled failed for %d: %v", id, err)
		}
		if _, err := m.historyRepo.Create(ctx, &id, url, "cancelled", nil); err != nil {
			log.Printf("queue: recording history for %d failed: %v", id, err)
		}
		m.broadcaster.Broadcast(ws.Event{Type: ws.EventFailed, Payload: ws.FailedPayload{DownloadID: id, Status: "cancelled", Error: "cancelled by user"}})
		return
	}

	if err := m.downloadsRepo.MarkFailed(ctx, id, -1, errMsg, stdoutTail, stderrTail); err != nil {
		log.Printf("queue: mark failed failed for %d: %v", id, err)
	}
	if _, err := m.historyRepo.Create(ctx, &id, url, "failed", &errMsg); err != nil {
		log.Printf("queue: recording history for %d failed: %v", id, err)
	}
	m.broadcaster.Broadcast(ws.Event{Type: ws.EventFailed, Payload: ws.FailedPayload{DownloadID: id, Status: "failed", Error: errMsg}})
}

// partialSuffixRE matches what yt-dlp appends to a destination file name while
// the download is unfinished: ".part", ".ytdl" and the fragment files
// ".part-Frag<N>" / ".part-Frag<N>.part".
var partialSuffixRE = regexp.MustCompile(`^\.(part|ytdl|part-Frag\d+(\.part)?)$`)

// removePartialFiles deletes the unfinished-download files of the destinations
// yt-dlp reported. It never globs by title: for each reported destination it
// reads that file's own directory (which must lie inside p.dir) and removes only
// regular files named exactly <destination file name> + a partial suffix. The
// destination itself, siblings sharing a shorter prefix and everything else
// stay. Nothing reported (or no known directory) removes nothing. Best-effort.
func removePartialFiles(p partialFiles) {
	if p.dir == "" {
		return
	}
	root := filepath.Clean(p.dir)
	for _, dest := range p.destinations {
		if dest == "" || !filepath.IsAbs(dest) {
			continue
		}
		dest = filepath.Clean(dest)
		dir, base := filepath.Dir(dest), filepath.Base(dest)
		if rel, err := filepath.Rel(root, dir); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			name := e.Name()
			suffix, ok := strings.CutPrefix(name, base)
			if !ok || !e.Type().IsRegular() || !partialSuffixRE.MatchString(suffix) {
				continue
			}
			if err := os.Remove(filepath.Join(dir, name)); err != nil && !os.IsNotExist(err) {
				log.Printf("queue: removing partial download file %s failed: %v", name, err)
			}
		}
	}
}

func (m *DownloadManager) onProgress(id int64, ev downloader.ProgressEvent) {
	status := models.StatusDownloading
	if ev.Status == "finished" {
		status = models.StatusProcessing
	}

	m.progress.Set(id, &LiveProgress{
		DownloadID:       id,
		Status:           status,
		Percent:          ev.Percent,
		SpeedBytesPerSec: ev.SpeedBytesPerSec,
		ETASeconds:       ev.ETASeconds,
		DownloadedBytes:  ev.DownloadedBytes,
		TotalBytes:       ev.TotalBytes,
		UpdatedAt:        time.Now(),
	})

	m.lastBroadcastMu.Lock()
	last, seen := m.lastBroadcastAt[id]
	shouldSend := !seen || time.Since(last) >= progressBroadcastInterval
	if shouldSend {
		m.lastBroadcastAt[id] = time.Now()
	}
	m.lastBroadcastMu.Unlock()

	if !shouldSend {
		return
	}

	m.broadcaster.Broadcast(ws.Event{Type: ws.EventProgress, Payload: ws.ProgressPayload{
		DownloadID: id,
		Status:     string(status),
		Percent:    ev.Percent,
		Speed:      ev.SpeedBytesPerSec,
		ETA:        ev.ETASeconds,
		Downloaded: ev.DownloadedBytes,
		Total:      ev.TotalBytes,
	}})
}

func (m *DownloadManager) broadcastQueueUpdate() {
	m.broadcaster.Broadcast(ws.Event{Type: ws.EventQueueUpdate, Payload: ws.QueueUpdatePayload{
		Active: int(atomic.LoadInt32(&m.activeCount)),
		Queued: m.jobs.Len(),
	}})
}

// HasActive reports whether any download is currently running — used by the
// stray-files scan to hold back temp files (.part etc.) that yt-dlp may still
// have open.
func (m *DownloadManager) HasActive() bool {
	return atomic.LoadInt32(&m.activeCount) > 0
}

// ProgressSnapshot exposes live progress for the API layer to merge with DB
// rows in GET /downloads.
func (m *DownloadManager) ProgressSnapshot() map[int64]*LiveProgress {
	return m.progress.Snapshot()
}

func (m *DownloadManager) MediaRoot() string {
	return m.mediaRoot
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

package queue

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/fsutil"
	"packrat/backend/internal/jellyfin"
	"packrat/backend/internal/models"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/repository"
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

type DownloadManager struct {
	mediaRoot        string
	ytdlp            *downloader.YtDlpService
	downloadsRepo    *repository.DownloadsRepo
	libraryRepo      *repository.LibraryRepo
	collectionsRepo  *repository.CollectionsRepo
	historyRepo      *repository.HistoryRepo
	artistsRepo      *repository.ArtistsRepo
	settingsRepo     *repository.SettingsRepo
	jellyfinClient   *jellyfin.Client
	jellyfinDebounce *jellyfin.Debouncer
	progress         *ProgressStore
	broadcaster      ws.Broadcaster

	jobs chan int64

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

	lastBroadcastMu sync.Mutex
	lastBroadcastAt map[int64]time.Time

	activeCount int32
	queuedCount int32
}

func NewDownloadManager(
	mediaRoot string,
	ytdlp *downloader.YtDlpService,
	downloadsRepo *repository.DownloadsRepo,
	libraryRepo *repository.LibraryRepo,
	collectionsRepo *repository.CollectionsRepo,
	historyRepo *repository.HistoryRepo,
	artistsRepo *repository.ArtistsRepo,
	settingsRepo *repository.SettingsRepo,
	jellyfinClient *jellyfin.Client,
	progress *ProgressStore,
	broadcaster ws.Broadcaster,
) *DownloadManager {
	m := &DownloadManager{
		mediaRoot:       mediaRoot,
		ytdlp:           ytdlp,
		downloadsRepo:   downloadsRepo,
		libraryRepo:     libraryRepo,
		collectionsRepo: collectionsRepo,
		historyRepo:     historyRepo,
		artistsRepo:     artistsRepo,
		settingsRepo:    settingsRepo,
		jellyfinClient:  jellyfinClient,
		progress:        progress,
		broadcaster:     broadcaster,
		jobs:            make(chan int64, 100),
		cancels:         make(map[int64]context.CancelFunc),
		lastBroadcastAt: make(map[int64]time.Time),
	}
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
		select {
		case <-stop:
			return
		case <-m.rootCtx.Done():
			return
		case id := <-m.jobs:
			atomic.AddInt32(&m.queuedCount, -1)
			m.runOne(m.rootCtx, id)
		}
	}
}

// SetWorkerCount resizes the pool to n workers, spawning or stopping as
// needed. Stopping a worker only prevents it from picking up its *next*
// job — any download it's currently running keeps going via rootCtx, which
// is never touched here.
func (m *DownloadManager) SetWorkerCount(n int) {
	m.workerMu.Lock()
	defer m.workerMu.Unlock()

	current := len(m.workerStops)
	switch {
	case n > current:
		for i := 0; i < n-current; i++ {
			stop := make(chan struct{})
			m.workerStops = append(m.workerStops, stop)
			go m.worker(stop)
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

// Enqueue creates a queued download row and schedules it for a worker.
func (m *DownloadManager) Enqueue(ctx context.Context, d models.Download) (int64, error) {
	d.Status = models.StatusQueued
	id, err := m.downloadsRepo.Create(ctx, &d)
	if err != nil {
		return 0, err
	}
	atomic.AddInt32(&m.queuedCount, 1)
	m.jobs <- id
	m.broadcastQueueUpdate()
	return id, nil
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
	if err := m.downloadsRepo.MarkCancelled(ctx, id); err != nil {
		return err
	}
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
	m.mu.Lock()
	m.cancels[id] = cancel
	m.mu.Unlock()

	atomic.AddInt32(&m.activeCount, 1)
	defer func() {
		atomic.AddInt32(&m.activeCount, -1)
		m.mu.Lock()
		delete(m.cancels, id)
		m.mu.Unlock()
		cancel()
		m.progress.Delete(id)
		m.lastBroadcastMu.Lock()
		delete(m.lastBroadcastAt, id)
		m.lastBroadcastMu.Unlock()
		m.broadcastQueueUpdate()
	}()

	if err := m.downloadsRepo.UpdateStatus(runCtx, id, models.StatusFetchingMetadata, nil); err != nil {
		log.Printf("queue: update status failed for %d: %v", id, err)
	}

	meta, err := m.ytdlp.FetchMetadata(runCtx, d.URL)
	if err != nil {
		m.finishError(parentCtx, runCtx, id, d.URL, err.Error(), "", "")
		return
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
	destDir, err := pathsafe.ResolveUnderRoot(effectiveRoot, d.Folder)
	if err != nil {
		m.finishError(parentCtx, runCtx, id, d.URL, "invalid folder: "+err.Error(), "", "")
		return
	}
	if err := fsutil.EnsureDir(destDir); err != nil {
		m.finishError(parentCtx, runCtx, id, d.URL, "creating destination directory: "+err.Error(), "", "")
		return
	}

	audioFormat := ""
	if d.AudioFormat != nil {
		audioFormat = *d.AudioFormat
	}

	// The literal Filename override always wins if set (existing,
	// unchanged behavior). Otherwise, a FilenamePrefix is combined with
	// effectiveTitle to build the name — e.g. "Matt.Iceberg.S01E01" +
	// "My big moment" -> "Matt.Iceberg.S01E01 My big moment". With
	// neither set, filename stays "" and yt-dlp's own default naming
	// applies, exactly as before this feature existed.
	filename := d.Filename
	if filename == "" && d.FilenamePrefix != nil && strings.TrimSpace(*d.FilenamePrefix) != "" {
		filename = strings.TrimSpace(*d.FilenamePrefix) + " " + effectiveTitle
	}

	job := downloader.DownloadJob{
		URL:          d.URL,
		DestDir:      destDir,
		Filename:     fsutil.SanitizeFilename(filename),
		DownloadType: d.DownloadType,
		Quality:      d.Quality,
		AudioFormat:  audioFormat,
	}

	if err := m.downloadsRepo.UpdateStatus(runCtx, id, models.StatusDownloading, nil); err != nil {
		log.Printf("queue: update status failed for %d: %v", id, err)
	}
	m.broadcastQueueUpdate()

	result, runErr := m.ytdlp.Run(runCtx, job, func(ev downloader.ProgressEvent) {
		m.onProgress(id, ev)
	})

	if runErr != nil {
		m.finishError(parentCtx, runCtx, id, d.URL, runErr.Error(), "", "")
		return
	}
	if result.ExitCode != 0 {
		m.finishError(parentCtx, runCtx, id, d.URL, fmt.Sprintf("yt-dlp exited with code %d", result.ExitCode), result.StdoutTail, result.StderrTail)
		return
	}

	if err := m.downloadsRepo.SetCommand(parentCtx, id, result.Command); err != nil {
		log.Printf("queue: set command failed for %d: %v", id, err)
	}
	var resolution *string
	if meta.Width > 0 && meta.Height > 0 {
		r := fmt.Sprintf("%dx%d", meta.Width, meta.Height)
		resolution = &r
	}
	if err := m.downloadsRepo.MarkCompleted(parentCtx, id, 0, resolution, result.StdoutTail, result.StderrTail); err != nil {
		log.Printf("queue: mark completed failed for %d: %v", id, err)
	}
	if _, err := m.historyRepo.Create(parentCtx, &id, d.URL, "completed", nil); err != nil {
		log.Printf("queue: recording history for %d failed: %v", id, err)
	}

	var sizeBytes *int64
	if info, err := os.Stat(result.FinalPath); err == nil {
		s := info.Size()
		sizeBytes = &s
	}

	libItem := m.buildLibraryItem(id, d, effectiveTitle, meta, result.FinalPath, resolution, sizeBytes)
	libID, err := m.libraryRepo.Create(parentCtx, libItem)
	if err != nil {
		log.Printf("queue: creating library item failed for %d: %v", id, err)
		return
	}

	m.triggerJellyfinRefresh(parentCtx, d)

	// Best-effort: keep the file's own tags in sync with whatever overrides
	// were provided at request time, same call shape library_handler.go's
	// UpdateLibraryItem already uses on manual edits. Skipped entirely when
	// no override was set, so a plain download never pays the ffmpeg remux
	// cost.
	if d.OverrideTitle != nil || d.OverrideArtistID != nil || d.OverrideYear != nil || d.OverrideSequenceNumber != nil || d.OverrideSeasonNumber != nil {
		var overrideArtistName *string
		if d.OverrideArtistID != nil {
			if a, err := m.artistsRepo.Get(context.Background(), *d.OverrideArtistID); err == nil {
				overrideArtistName = &a.Name
			}
		}
		go func(path, title string, artist *string, year, seq, season *int) {
			if err := m.ytdlp.EmbedMetadata(context.Background(), path, title, artist, year, seq, season); err != nil {
				log.Printf("queue: embedding metadata into %s failed: %v", path, err)
			}
		}(result.FinalPath, effectiveTitle, overrideArtistName, d.OverrideYear, d.OverrideSequenceNumber, d.OverrideSeasonNumber)
	}

	m.broadcaster.Broadcast(ws.Event{Type: ws.EventCompleted, Payload: ws.CompletedPayload{DownloadID: id, LibraryID: libID, Title: libItem.Title}})
}

func (m *DownloadManager) buildLibraryItem(downloadID int64, d *models.Download, title string, meta *downloader.Metadata, finalPath string, resolution *string, sizeBytes *int64) *models.LibraryItem {
	// Stored as forward-slash paths regardless of host OS, since these are
	// read back purely to build URLs for the /media-files static route (the
	// frontend splits on "/") — filepath.Rel on Windows returns
	// backslash-separated paths, which would silently 404 as a URL.
	relPath := filepath.ToSlash(finalPath)
	if rel, err := filepath.Rel(m.mediaRoot, finalPath); err == nil {
		relPath = filepath.ToSlash(rel)
	}

	var thumbRelPtr *string
	thumbAbs := thumbnailPathFor(finalPath)
	if thumbAbs != "" {
		if rel, err := filepath.Rel(m.mediaRoot, thumbAbs); err == nil {
			relSlash := filepath.ToSlash(rel)
			thumbRelPtr = &relSlash
		}
	}

	duration := int(meta.Duration)
	uploader := meta.Uploader
	videoID := meta.ID
	description := meta.Description

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
	switch classifyRunCtxErr(runCtx.Err()) {
	case "timeout":
		timeoutMsg := "download exceeded the configured time limit and was stopped"
		if err := m.downloadsRepo.MarkFailed(parentCtx, id, -1, timeoutMsg, stdoutTail, stderrTail); err != nil {
			log.Printf("queue: mark failed failed for %d: %v", id, err)
		}
		if _, err := m.historyRepo.Create(parentCtx, &id, url, "failed", &timeoutMsg); err != nil {
			log.Printf("queue: recording history for %d failed: %v", id, err)
		}
		m.broadcaster.Broadcast(ws.Event{Type: ws.EventFailed, Payload: ws.FailedPayload{DownloadID: id, Status: "failed", Error: timeoutMsg}})
		return
	case "cancelled":
		if err := m.downloadsRepo.MarkCancelled(parentCtx, id); err != nil {
			log.Printf("queue: mark cancelled failed for %d: %v", id, err)
		}
		if _, err := m.historyRepo.Create(parentCtx, &id, url, "cancelled", nil); err != nil {
			log.Printf("queue: recording history for %d failed: %v", id, err)
		}
		m.broadcaster.Broadcast(ws.Event{Type: ws.EventFailed, Payload: ws.FailedPayload{DownloadID: id, Status: "cancelled", Error: "cancelled by user"}})
		return
	}

	if err := m.downloadsRepo.MarkFailed(parentCtx, id, -1, errMsg, stdoutTail, stderrTail); err != nil {
		log.Printf("queue: mark failed failed for %d: %v", id, err)
	}
	if _, err := m.historyRepo.Create(parentCtx, &id, url, "failed", &errMsg); err != nil {
		log.Printf("queue: recording history for %d failed: %v", id, err)
	}
	m.broadcaster.Broadcast(ws.Event{Type: ws.EventFailed, Payload: ws.FailedPayload{DownloadID: id, Status: "failed", Error: errMsg}})
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
		Queued: int(atomic.LoadInt32(&m.queuedCount)),
	}})
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

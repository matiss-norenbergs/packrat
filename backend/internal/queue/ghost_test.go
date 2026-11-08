package queue

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"packrat/backend/internal/db"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
)

// fakeYtDlp stands in for the yt-dlp binary: --dump-single-json prints canned
// metadata (or fails for a URL containing "badmeta"), a download writes a tiny
// file at the -o template and prints the PACKRAT-FILEPATH line. Marker files
// next to the script switch behavior mid-test: "fail" makes downloads exit 1,
// "slow" makes them hang until killed, "nopath" makes them exit 0 without writing
// a file or printing the path, "exitafter" makes them write the file, print the
// path and then exit 1 (a failed thumbnail postprocessing step). The video id is
// the "vid=" query value of the URL (default "vid1") and ends up in the written
// file's content ("data:<id>", plain "data" without one). Like the real yt-dlp, a download whose target
// already exists is skipped (unless --force-overwrites): it prints "has already
// been downloaded" and the path, and writes nothing.
const fakeYtDlp = `#!/bin/sh
dir=$(dirname "$0")
url=""; meta=""; prev=""; out=""; force=""
for a in "$@"; do
  [ "$a" = "--dump-single-json" ] && meta=1
  [ "$a" = "--force-overwrites" ] && force=1
  [ "$prev" = "-o" ] && out="$a"
  prev="$a"; url="$a"
done
thumb=""; [ -f "$dir/thumburl" ] && thumb=$(cat "$dir/thumburl")
vid=$(echo "$url" | sed -n 's/.*[?&]vid=\([^&]*\).*/\1/p')
id=${vid:-vid1}
case "$url" in *badmeta*) echo "ERROR: unsupported URL" >&2; exit 1;; esac
if [ -n "$meta" ]; then
  echo '{"id":"'"$id"'","title":"Fake Title","uploader":"Up","duration":12,"thumbnail":"'"$thumb"'","description":"desc"}'
  exit 0
fi
if [ -f "$dir/partial" ]; then
  d=$(dirname "$(echo "$out" | tr '\\' '/')")
  [ -f "$dir/nodest" ] || echo "[download] Destination: $d/Clip.f137.mp4"
  echo x > "$d/Clip.f137.mp4.part"; echo x > "$d/Clip.f137.mp4.ytdl"
  if [ -f "$dir/fail" ]; then echo "boom" >&2; exit 1; fi
  exec sleep 30
fi
[ -f "$dir/slow" ] && exec sleep 30
if [ -f "$dir/fail" ]; then echo "boom" >&2; exit 1; fi
if [ -f "$dir/nopath" ]; then exit 0; fi
path=$(echo "$out" | sed -e 's/%(ext)s/mp4/' -e 's/%(title)s/Fake_Title/')
if [ -f "$path" ] && [ -z "$force" ]; then
  echo "[download] $path has already been downloaded"
else
  echo "data${vid:+:$vid}" > "$path"
fi
echo "PACKRAT-FILEPATH:$path"
if [ -f "$dir/exitafter" ]; then echo "thumbnail conversion failed" >&2; exit 1; fi
`

type recordingBroadcaster struct {
	mu     sync.Mutex
	events []ws.Event
	onEvt  func(ws.Event)
}

func (b *recordingBroadcaster) Broadcast(e ws.Event) {
	b.mu.Lock()
	b.events = append(b.events, e)
	cb := b.onEvt
	b.mu.Unlock()
	if cb != nil {
		cb(e)
	}
}

func (b *recordingBroadcaster) reasons() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []string
	for _, e := range b.events {
		if e.Type == ws.EventLibraryChanged {
			out = append(out, e.Payload.(ws.LibraryChangedPayload).Reason)
		}
	}
	return out
}

type ghostEnv struct {
	t          *testing.T
	conn       *sql.DB
	mgr        *DownloadManager
	downloads  *repository.DownloadsRepo
	library    *repository.LibraryRepo
	tags       *repository.TagsRepo
	bc         *recordingBroadcaster
	binDir     string
	mediaRoot  string
	imagesRoot string
}

func newGhostEnv(t *testing.T) *ghostEnv {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatal(err)
	}

	e := &ghostEnv{t: t, conn: conn, binDir: t.TempDir(), mediaRoot: t.TempDir(), imagesRoot: t.TempDir(), bc: &recordingBroadcaster{}}
	bin := filepath.Join(e.binDir, "yt-dlp")
	if err := os.WriteFile(bin, []byte(fakeYtDlp), 0o755); err != nil {
		t.Fatal(err)
	}
	settings := repository.NewSettingsRepo(conn)
	e.downloads = repository.NewDownloadsRepo(conn)
	e.library = repository.NewLibraryRepo(conn)
	e.tags = repository.NewTagsRepo(conn)
	ytdlp := downloader.NewYtDlpService(bin, "ffmpeg-missing", "", settings, 1)
	e.mgr = NewDownloadManager(e.mediaRoot, e.imagesRoot, "ffprobe-missing", ytdlp, e.downloads, e.library,
		repository.NewCollectionsRepo(conn), repository.NewHistoryRepo(conn), repository.NewArtistsRepo(conn), e.tags,
		settings, nil, nil, nil, NewProgressStore(), e.bc)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	e.mgr.rootCtx = ctx
	return e
}

func (e *ghostEnv) flag(name string, on bool) {
	e.t.Helper()
	p := filepath.Join(e.binDir, name)
	if on {
		if err := os.WriteFile(p, nil, 0o644); err != nil {
			e.t.Fatal(err)
		}
	} else {
		os.Remove(p)
	}
}

func (e *ghostEnv) newDownload(d models.Download) int64 {
	e.t.Helper()
	if d.URL == "" {
		d.URL = "https://example.test/watch?v=1"
	}
	if d.DownloadType == "" {
		d.DownloadType = "video"
	}
	d.Quality = "best"
	d.Status = models.StatusQueued
	id, err := e.downloads.Create(context.Background(), &d)
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *ghostEnv) items() []models.LibraryItem {
	e.t.Helper()
	items, err := e.library.List(context.Background())
	if err != nil {
		e.t.Fatal(err)
	}
	return items
}

func (e *ghostEnv) download(id int64) *models.Download {
	e.t.Helper()
	d, err := e.downloads.Get(context.Background(), id)
	if err != nil {
		e.t.Fatal(err)
	}
	return d
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestGhostCreatedThenFilledInPlace(t *testing.T) {
	e := newGhostEnv(t)
	year := 2020
	id := e.newDownload(models.Download{OverrideYear: &year, OverrideTags: []string{"t1"}, GenerateNFO: false, Folder: "sub"})

	var ghostSeen *models.LibraryItem
	var ghostTags []string
	e.bc.onEvt = func(ev ws.Event) {
		if ev.Type != ws.EventLibraryChanged || ev.Payload.(ws.LibraryChangedPayload).Reason != "ghost_created" {
			return
		}
		items := e.items()
		if len(items) == 1 {
			ghostSeen = &items[0]
			ghostTags, _ = e.tags.TagsForLibraryItem(context.Background(), items[0].ID)
		}
	}
	e.mgr.runOne(context.Background(), id)

	if ghostSeen == nil {
		t.Fatal("no ghost was announced / visible when created")
	}
	if ghostSeen.Status != "ghost" || ghostSeen.Filename != "" || ghostSeen.Path != "" {
		t.Fatalf("ghost should be empty-file status ghost, got %+v", ghostSeen)
	}
	if ghostSeen.Title != "Fake Title" || ghostSeen.DownloadID == nil || *ghostSeen.DownloadID != id ||
		ghostSeen.ReleaseYear == nil || *ghostSeen.ReleaseYear != 2020 || ghostSeen.Folder != "sub" {
		t.Fatalf("ghost missing metadata/overrides: %+v", ghostSeen)
	}
	if len(ghostTags) != 1 || ghostTags[0] != "t1" {
		t.Fatalf("ghost tags = %v", ghostTags)
	}
	if got := e.download(id).GhostLibraryItemID; got == nil || *got != ghostSeen.ID {
		t.Fatalf("download.ghost_library_item_id = %v, want %d", got, ghostSeen.ID)
	}

	items := e.items()
	if len(items) != 1 {
		t.Fatalf("want exactly 1 library row after completion, got %d", len(items))
	}
	it := items[0]
	if it.ID != ghostSeen.ID {
		t.Fatalf("completion created a new row (id %d) instead of filling ghost %d", it.ID, ghostSeen.ID)
	}
	if it.Status != "completed" || it.Filename == "" || it.Path == "" || it.FileSizeBytes == nil || *it.FileSizeBytes == 0 {
		t.Fatalf("row not filled in: %+v", it)
	}
	if !strings.HasPrefix(it.Path, "sub/") {
		t.Fatalf("file should land in the requested folder, path = %q", it.Path)
	}
	if it.ReleaseYear == nil || *it.ReleaseYear != 2020 {
		t.Fatalf("year override lost: %+v", it.ReleaseYear)
	}
	// A ghost this run created takes the download's own values.
	if it.Title != "Fake Title" || it.Uploader == nil || *it.Uploader != "Up" || it.Description == nil || *it.Description != "desc" {
		t.Fatalf("run-created ghost should take the download's metadata: %+v", it)
	}
	if tags, _ := e.tags.TagsForLibraryItem(context.Background(), it.ID); len(tags) != 1 {
		t.Fatalf("tags after completion = %v", tags)
	}
	if e.download(id).Status != models.StatusCompleted {
		t.Fatalf("download status = %s", e.download(id).Status)
	}
}

func TestNoGhostWhenMetadataFetchFails(t *testing.T) {
	e := newGhostEnv(t)
	id := e.newDownload(models.Download{URL: "https://example.test/badmeta"})
	e.mgr.runOne(context.Background(), id)
	if n := len(e.items()); n != 0 {
		t.Fatalf("a failed metadata fetch left %d library rows", n)
	}
	if e.download(id).Status != models.StatusFailed {
		t.Fatalf("status = %s", e.download(id).Status)
	}
	if r := e.bc.reasons(); len(r) != 0 {
		t.Fatalf("unexpected library events %v", r)
	}
}

func TestNoGhostWhenFolderInvalid(t *testing.T) {
	e := newGhostEnv(t)
	id := e.newDownload(models.Download{Folder: "../escape"})
	e.mgr.runOne(context.Background(), id)
	if n := len(e.items()); n != 0 {
		t.Fatalf("an invalid folder left %d library rows", n)
	}
	if e.download(id).Status != models.StatusFailed {
		t.Fatalf("status = %s", e.download(id).Status)
	}
}

func TestNoGhostForImageDownloads(t *testing.T) {
	e := newGhostEnv(t)
	// Unreachable on purpose: the image path must fail on its own fetch, never
	// through a metadata call, and never leave a ghost.
	id := e.newDownload(models.Download{URL: "http://127.0.0.1:1/x.png", DownloadType: "image"})
	e.mgr.runOne(context.Background(), id)
	if n := len(e.items()); n != 0 {
		t.Fatalf("image download left %d library rows", n)
	}
	if r := e.bc.reasons(); len(r) != 0 {
		t.Fatalf("image download announced %v", r)
	}
}

func TestFailureKeepsGhostAndRetryReusesIt(t *testing.T) {
	e := newGhostEnv(t)
	e.flag("fail", true)
	id := e.newDownload(models.Download{})
	e.mgr.runOne(context.Background(), id)

	items := e.items()
	if len(items) != 1 || items[0].Status != "ghost" {
		t.Fatalf("a failed download should leave its ghost, got %+v", items)
	}
	ghostID := items[0].ID
	if e.download(id).Status != models.StatusFailed {
		t.Fatalf("status = %s", e.download(id).Status)
	}
	if got := e.download(id).GhostLibraryItemID; got == nil || *got != ghostID {
		t.Fatalf("failed download lost its ghost link: %v", got)
	}

	// The user edits the kept ghost's text before retrying.
	edited, up, desc := "My edited title", "My uploader", "My description"
	if err := e.library.UpdateMetadata(context.Background(), ghostID, &edited, &up, nil, nil, &desc, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}

	// Retry: a fresh download row carrying the ghost id (what the history retry builds).
	e.flag("fail", false)
	retryID := e.newDownload(models.Download{GhostLibraryItemID: &ghostID})
	if active, _ := e.downloads.ActiveDownloadIDsByLibraryItem(context.Background(), []int64{ghostID}); active[ghostID] != retryID {
		t.Fatalf("queued retry should be the ghost's active download, got %v", active)
	}
	e.mgr.runOne(context.Background(), retryID)

	items = e.items()
	if len(items) != 1 {
		t.Fatalf("retry created a second library row: %+v", items)
	}
	if items[0].ID != ghostID || items[0].Status != "completed" || items[0].Path == "" {
		t.Fatalf("retry did not fill the original ghost: %+v", items[0])
	}
	// The reused ghost keeps its own (edited) text; the fake yt-dlp says "Fake Title"/"Up"/"desc".
	if items[0].Title != edited || items[0].Uploader == nil || *items[0].Uploader != up || items[0].Description == nil || *items[0].Description != desc {
		t.Fatalf("retry overwrote the ghost's edited metadata: %+v", items[0])
	}
	if active, _ := e.downloads.ActiveDownloadIDsByLibraryItem(context.Background(), []int64{ghostID}); len(active) != 0 {
		t.Fatalf("finished item still reports an active download: %v", active)
	}
}

func TestCancelRemovesRunCreatedGhostAndDerivatives(t *testing.T) {
	e := newGhostEnv(t)
	e.flag("slow", true)
	id := e.newDownload(models.Download{})
	done := make(chan struct{})
	go func() { e.mgr.runOne(context.Background(), id); close(done) }()

	var ghostID int64
	waitFor(t, "ghost + downloading", func() bool {
		items := e.items()
		if len(items) != 1 || e.download(id).Status != models.StatusDownloading {
			return false
		}
		ghostID = items[0].ID
		return true
	})
	// A derivative file the ghost would own (as its thumbnail tiers do).
	deriv := filepath.Join(e.imagesRoot, "library", itoa(ghostID), "small.webp")
	if err := os.MkdirAll(filepath.Dir(deriv), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(deriv, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := e.mgr.Cancel(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	<-done

	if n := len(e.items()); n != 0 {
		t.Fatalf("cancelled run left %d library rows", n)
	}
	if _, err := os.Stat(filepath.Dir(deriv)); !os.IsNotExist(err) {
		t.Fatalf("ghost derivative dir not removed: %v", err)
	}
	if e.download(id).Status != models.StatusCancelled {
		t.Fatalf("status = %s", e.download(id).Status)
	}
	if r := e.bc.reasons(); len(r) != 2 || r[0] != "ghost_created" || r[1] != "ghost_removed" {
		t.Fatalf("library events = %v", r)
	}
}

func TestCancelKeepsPreExistingGhost(t *testing.T) {
	e := newGhostEnv(t)
	ghostID := e.makeGhost("pre-existing")
	e.flag("slow", true)
	id := e.newDownload(models.Download{GhostLibraryItemID: &ghostID})
	done := make(chan struct{})
	go func() { e.mgr.runOne(context.Background(), id); close(done) }()
	waitFor(t, "downloading", func() bool { return e.download(id).Status == models.StatusDownloading })

	if err := e.mgr.Cancel(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	<-done

	items := e.items()
	if len(items) != 1 || items[0].ID != ghostID || items[0].Status != "ghost" {
		t.Fatalf("a pre-existing ghost must survive a cancel, got %+v", items)
	}
}

func TestDeletedGhostAtCompletionFallsBackToCreate(t *testing.T) {
	e := newGhostEnv(t)
	id := e.newDownload(models.Download{})
	e.bc.onEvt = func(ev ws.Event) {
		if ev.Type == ws.EventLibraryChanged && ev.Payload.(ws.LibraryChangedPayload).Reason == "ghost_created" {
			e.library.Delete(context.Background(), ev.Payload.(ws.LibraryChangedPayload).LibraryID)
		}
	}
	e.mgr.runOne(context.Background(), id)
	items := e.items()
	if len(items) != 1 || items[0].Status != "completed" || items[0].Path == "" {
		t.Fatalf("file must not be lost when the ghost vanished: %+v", items)
	}
}

func TestInterruptedStartupKeepsGhost(t *testing.T) {
	e := newGhostEnv(t)
	ghostID := e.makeGhost("mid-download")
	id := e.newDownload(models.Download{GhostLibraryItemID: &ghostID})
	if err := e.downloads.UpdateStatus(context.Background(), id, models.StatusDownloading, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := e.downloads.MarkInterruptedIfActive(context.Background()); err != nil {
		t.Fatal(err)
	}
	items := e.items()
	if len(items) != 1 || items[0].Status != "ghost" {
		t.Fatalf("interrupted download must leave its ghost: %+v", items)
	}
	if active, _ := e.downloads.ActiveDownloadIDsByLibraryItem(context.Background(), []int64{ghostID}); len(active) != 0 {
		t.Fatalf("interrupted download is not active: %v", active)
	}
}

func (e *ghostEnv) makeGhost(title string) int64 {
	e.t.Helper()
	id, err := e.library.Create(context.Background(), &models.LibraryItem{Title: title, Status: "ghost"})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

// A thumbnail URL from remote metadata that points at a private address is
// refused without touching that address, and the download still completes.
func TestRefusedPrivateThumbnailDoesNotFailDownload(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte("png"))
	}))
	defer srv.Close()

	e := newGhostEnv(t)
	if err := os.WriteFile(filepath.Join(e.binDir, "thumburl"), []byte(srv.URL+"/t.png"), 0o644); err != nil {
		t.Fatal(err)
	}
	id := e.newDownload(models.Download{})
	e.mgr.runOne(context.Background(), id)

	if got := hits.Load(); got != 0 {
		t.Fatalf("the loopback thumbnail server was contacted %d time(s)", got)
	}
	if e.download(id).Status != models.StatusCompleted {
		t.Fatalf("download status = %s, want completed", e.download(id).Status)
	}
	items := e.items()
	if len(items) != 1 || items[0].Status != "completed" {
		t.Fatalf("library items = %+v", items)
	}
}

func TestFetchRemoteThumbnailErrorHasNoURL(t *testing.T) {
	_, err := fetchRemoteThumbnail(context.Background(), "http://127.0.0.1:9/secret?token=abc", t.TempDir(), "")
	if err == nil {
		t.Fatal("want an error")
	}
	if strings.Contains(err.Error(), "token") || strings.Contains(err.Error(), "127.0.0.1") {
		t.Fatalf("error leaks the URL: %v", err)
	}
}

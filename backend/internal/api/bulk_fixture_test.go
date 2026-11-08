package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/twofactor"
	"packrat/backend/internal/ws"
)

// bkEnv is the REAL router (SetupRouter: auth, CSRF, the notDownloading and
// feature middleware, route registration) over a throwaway database, logged in
// with the web cookie flow. Everything the bulk-endpoint tests need hangs off it.
type bkEnv struct {
	t       *testing.T
	r       *gin.Engine
	conn    *sql.DB
	cookies []*http.Cookie
	csrf    string

	library     *repository.LibraryRepo
	downloads   *repository.DownloadsRepo
	history     *repository.HistoryRepo
	subs        *repository.SubscriptionsRepo
	backups     *repository.BackupHistoryRepo
	gallery     *repository.ThumbnailGalleryRepo
	tags        *repository.TagsRepo
	artists     *repository.ArtistsRepo
	settings    *repository.SettingsRepo
	mgr         *queue.DownloadManager
	mediaRoot   string
	imagesRoot  string
	backupsRoot string
	// embedLog records one line per ffmpeg metadata embed (a fake ffmpeg
	// script appends its arguments), so tests can count embeds per item.
	embedLog string
}

func newBkEnv(t *testing.T) *bkEnv {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("uses a shell script as a fake ffmpeg")
	}
	gin.SetMode(gin.TestMode)
	conn := openMigratedTestDB(t)

	e := &bkEnv{
		t: t, conn: conn,
		library:     repository.NewLibraryRepo(conn),
		downloads:   repository.NewDownloadsRepo(conn),
		history:     repository.NewHistoryRepo(conn),
		subs:        repository.NewSubscriptionsRepo(conn),
		backups:     repository.NewBackupHistoryRepo(conn),
		gallery:     repository.NewThumbnailGalleryRepo(conn),
		tags:        repository.NewTagsRepo(conn),
		artists:     repository.NewArtistsRepo(conn),
		settings:    repository.NewSettingsRepo(conn),
		mediaRoot:   t.TempDir(),
		imagesRoot:  t.TempDir(),
		backupsRoot: t.TempDir(),
	}
	collections := repository.NewCollectionsRepo(conn)

	// Fake ffmpeg: log the arguments, copy the input ($3) over the output (last arg).
	scriptDir := t.TempDir()
	e.embedLog = filepath.Join(scriptDir, "embeds.log")
	ffmpeg := filepath.Join(scriptDir, "ffmpeg")
	script := "#!/bin/sh\necho \"$@\" >> '" + e.embedLog + "'\nfor last; do :; done\ncp \"$3\" \"$last\"\n"
	if err := os.WriteFile(ffmpeg, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	ytdlp := &downloader.YtDlpService{BinPath: "/bin/false", FFmpegPath: ffmpeg, SettingsRepo: e.settings}

	// Not started: enqueued downloads just land in the queue.
	e.mgr = queue.NewDownloadManager(e.mediaRoot, e.imagesRoot, "", ytdlp, e.downloads, e.library, collections, e.history, nil, nil, e.settings, nil, nil, nil, queue.NewProgressStore(), ws.NoopBroadcaster{})
	t.Cleanup(e.mgr.Embedder().Wait)

	users := repository.NewUsersRepo(conn)
	deps := Deps{
		DB: conn, Manager: e.mgr,
		DownloadsRepo: e.downloads, LibraryRepo: e.library, CollectionsRepo: collections, SettingsRepo: e.settings,
		HistoryRepo: e.history, TagsRepo: e.tags, ArtistsRepo: e.artists, UsersRepo: users,
		UserPreferencesRepo:  repository.NewUserPreferencesRepo(conn),
		UserTableLayoutsRepo: repository.NewUserTableLayoutsRepo(conn),
		BackupHistoryRepo:    e.backups, SubscriptionsRepo: e.subs, ThumbnailGalleryRepo: e.gallery,
		ThumbnailEnhancementHistoryRepo:   repository.NewThumbnailEnhancementHistoryRepo(conn),
		ThumbnailEnhancementOriginalsRepo: repository.NewThumbnailEnhancementOriginalsRepo(conn),
		CompareListRepo:                   repository.NewCompareListRepo(conn),
		FrameMatchQueueRepo:               repository.NewFrameMatchQueueRepo(conn),
		YtDlp:                             ytdlp,
		MediaRoot:                         e.mediaRoot, ImagesRoot: e.imagesRoot, BackupsRoot: e.backupsRoot,
		Broadcaster: ws.NoopBroadcaster{},
		Auth:        NewAuthDeps(users, twofactor.NewCrypto([]byte("test-key")), time.Now),
	}
	e.r = SetupRouter(deps)

	cookies, _ := setupAndLogin(t, e.r)
	e.cookies = cookies
	for _, c := range cookies {
		if c.Name == csrfCookieName {
			e.csrf = c.Value
		}
	}
	if e.csrf == "" {
		t.Fatal("login set no CSRF cookie")
	}
	if err := e.settings.Set(context.Background(), models.SettingFeatureSubscriptionsEnabled, "true"); err != nil {
		t.Fatal(err)
	}
	return e
}

// send performs a request as the logged-in web client. withCSRF=false omits the
// X-CSRF-Token header.
func (e *bkEnv) send(method, path, body string, withCSRF bool) *httptest.ResponseRecorder {
	e.t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for _, c := range e.cookies {
		req.AddCookie(c)
	}
	if withCSRF {
		req.Header.Set("X-CSRF-Token", e.csrf)
	}
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, req)
	return w
}

// post is a CSRF-protected POST under /api.
func (e *bkEnv) post(path, body string) *httptest.ResponseRecorder {
	e.t.Helper()
	return e.send(http.MethodPost, "/api"+path, body, true)
}

// bkJSON marshals v for a request body.
func bkJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// decode unmarshals a recorder's body, failing the test on a mismatch.
func bkDecode[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	dec := json.NewDecoder(bytes.NewReader(w.Body.Bytes()))
	if err := dec.Decode(&out); err != nil {
		t.Fatalf("decoding %q: %v", w.Body.String(), err)
	}
	return out
}

func (e *bkEnv) want(w *httptest.ResponseRecorder, code int) {
	e.t.Helper()
	if w.Code != code {
		e.t.Fatalf("status = %d, want %d: %s", w.Code, code, w.Body)
	}
}

// download inserts a download row in the given status.
func (e *bkEnv) download(status models.DownloadStatus) int64 {
	e.t.Helper()
	id, err := e.downloads.Create(context.Background(), &models.Download{URL: "https://example.test/v", DownloadType: "video", Quality: "best", Status: status})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

// item inserts a completed library item backed by a real media file.
func (e *bkEnv) item(name string) int64 {
	e.t.Helper()
	writeFile(e.t, filepath.Join(e.mediaRoot, name+".mp4"))
	id, err := e.library.Create(context.Background(), &models.LibraryItem{
		Title: name, Filename: name + ".mp4", Path: name + ".mp4", Status: "completed",
	})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *bkEnv) embedLines() []string {
	e.t.Helper()
	e.mgr.Embedder().Wait()
	raw, err := os.ReadFile(e.embedLog)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		e.t.Fatal(err)
	}
	return strings.Split(strings.TrimSpace(string(raw)), "\n")
}

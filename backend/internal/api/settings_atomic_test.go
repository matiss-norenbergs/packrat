package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/backup"
	"packrat/backend/internal/db"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
)

type atomicEnv struct {
	t           *testing.T
	conn        *sql.DB
	settings    *repository.SettingsRepo
	collections *repository.CollectionsRepo
	tags        *repository.TagsRepo
	artists     *repository.ArtistsRepo
	library     *repository.LibraryRepo
	downloads   *repository.DownloadsRepo
	mgr         *queue.DownloadManager
	ytdlp       *downloader.YtDlpService
	cookiesPath string
	router      *gin.Engine
	subsFired   int
}

// newAtomicEnv wires the settings / backup handlers against a real migrated
// database, a real (never-Started) download manager and a yt-dlp service whose
// cookies file lives in a temp dir.
func newAtomicEnv(t *testing.T) *atomicEnv {
	t.Helper()
	gin.SetMode(gin.TestMode)
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatalf("opening test db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatalf("migrating test db: %v", err)
	}
	e := &atomicEnv{
		t:           t,
		conn:        conn,
		settings:    repository.NewSettingsRepo(conn),
		collections: repository.NewCollectionsRepo(conn),
		tags:        repository.NewTagsRepo(conn),
		artists:     repository.NewArtistsRepo(conn),
		library:     repository.NewLibraryRepo(conn),
		downloads:   repository.NewDownloadsRepo(conn),
		cookiesPath: filepath.Join(t.TempDir(), "ytdlp-cookies.txt"),
	}
	e.ytdlp = downloader.NewYtDlpService("", "", "", e.settings, 1)
	e.ytdlp.CookiesFilePath = e.cookiesPath
	e.mgr = queue.NewDownloadManager(t.TempDir(), t.TempDir(), "", e.ytdlp, e.downloads, e.library, e.collections, nil, nil, nil, e.settings, nil, nil, nil, queue.NewProgressStore(), ws.NoopBroadcaster{})

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	e.mgr.Start(ctx, 1)

	e.router = gin.New()
	e.router.PATCH("/settings", UpdateSettings(e.settings, e.mgr, e.ytdlp, nil, func() { e.subsFired++ }))
	e.router.POST("/import/settings", ImportSettings(e.settings, e.mgr, e.ytdlp))
	e.router.POST("/import/full", ImportFullBackup(conn, e.settings, e.collections, e.tags, e.artists, e.library, e.mgr, e.ytdlp))
	return e
}

func (e *atomicEnv) do(method, path string, body any) *httptest.ResponseRecorder {
	e.t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		e.t.Fatal(err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	e.router.ServeHTTP(w, req)
	return w
}

func (e *atomicEnv) get(key string) string {
	e.t.Helper()
	v, err := e.settings.Get(context.Background(), key)
	if err != nil {
		e.t.Fatalf("Get %s: %v", key, err)
	}
	return v
}

// sealImport builds the request body for an import endpoint.
func sealImport(t *testing.T, kind string, payload any) map[string]any {
	t.Helper()
	plain, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	env, err := backup.Seal(kind, plain, "")
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{"data": string(data)}
}

func TestUpdateSettings_ValidationFailureChangesNothing(t *testing.T) {
	e := newAtomicEnv(t)
	before := e.get(models.SettingMaxConcurrentDownloads)
	workersBefore := e.mgr.WorkerCount()

	// The audit's example: the resolution pair is invalid, so the request must
	// fail without having grown the pool or saved maxConcurrentDownloads.
	w := e.do(http.MethodPatch, "/settings", map[string]any{
		"maxConcurrentDownloads":  8,
		"resolutionThresholdLow":  2160,
		"resolutionThresholdHigh": 720,
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	if got := e.get(models.SettingMaxConcurrentDownloads); got != before {
		t.Fatalf("maxConcurrentDownloads saved despite 400: %q -> %q", before, got)
	}
	if got := e.mgr.WorkerCount(); got != workersBefore {
		t.Fatalf("worker pool changed despite 400: %d -> %d", workersBefore, got)
	}
}

func TestUpdateSettings_ValidMultiFieldWritesAllAndAppliesSideEffects(t *testing.T) {
	e := newAtomicEnv(t)
	w := e.do(http.MethodPatch, "/settings", map[string]any{
		"maxConcurrentDownloads":  3,
		"maxConcurrentTranscodes": 2,
		"defaultQuality":          "720p",
		"resolutionThresholdLow":  480,
		"resolutionThresholdHigh": 1440,
	})
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	for key, want := range map[string]string{
		models.SettingMaxConcurrentDownloads:  "3",
		models.SettingMaxConcurrentTranscodes: "2",
		models.SettingDefaultQuality:          "720p",
		models.SettingResolutionThresholdLow:  "480",
		models.SettingResolutionThresholdHigh: "1440",
	} {
		if got := e.get(key); got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}
	if got := e.mgr.WorkerCount(); got != 3 {
		t.Errorf("worker pool = %d, want 3", got)
	}
	if got := e.ytdlp.MaxConcurrentTranscodes(); got != 2 {
		t.Errorf("transcodes = %d, want 2", got)
	}
}

func TestUpdateSettings_SubscriptionsCallbackFiresAfterCommit(t *testing.T) {
	e := newAtomicEnv(t)
	ctx := context.Background()
	if err := e.settings.Set(ctx, models.SettingFeatureSubscriptionsEnabled, "false"); err != nil {
		t.Fatal(err)
	}
	// A request that fails validation must not fire it or save the flag.
	w := e.do(http.MethodPatch, "/settings", map[string]any{
		"featureSubscriptionsEnabled": true,
		"resolutionThresholdLow":      2160,
		"resolutionThresholdHigh":     720,
	})
	if w.Code != http.StatusBadRequest || e.subsFired != 0 {
		t.Fatalf("status = %d, fired = %d", w.Code, e.subsFired)
	}
	if got := e.get(models.SettingFeatureSubscriptionsEnabled); got != "false" {
		t.Fatalf("feature flag saved despite 400: %q", got)
	}

	w = e.do(http.MethodPatch, "/settings", map[string]any{"featureSubscriptionsEnabled": true})
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	if e.subsFired != 1 {
		t.Fatalf("callback fired %d times, want 1", e.subsFired)
	}
}

// failingLibraryBundle makes backup.ApplyLibraryBundle fail by installing a
// trigger that rejects tag inserts, then returning a bundle with a new tag.
func failingLibraryBundle(t *testing.T, e *atomicEnv) backup.LibraryBundle {
	t.Helper()
	if _, err := e.conn.Exec(`CREATE TRIGGER reject_tags BEFORE INSERT ON tags
		BEGIN SELECT RAISE(ABORT, 'tag rejected'); END`); err != nil {
		t.Fatal(err)
	}
	return backup.LibraryBundle{Tags: []backup.TagEntry{{Name: "boom"}}}
}

func TestFullRestore_LibraryFailureLeavesSettingsUntouched(t *testing.T) {
	e := newAtomicEnv(t)
	ctx := context.Background()
	if err := e.settings.Set(ctx, models.SettingJellyfinAPIKey, "old-key"); err != nil {
		t.Fatal(err)
	}
	before, _ := e.settings.GetAll(ctx)
	workersBefore := e.mgr.WorkerCount()

	lib := failingLibraryBundle(t, e)
	w := e.do(http.MethodPost, "/import/full", sealImport(t, "full", backup.FullBundle{
		Settings: map[string]string{
			models.SettingJellyfinAPIKey:         "new-key",
			models.SettingMaxConcurrentDownloads: "7",
			models.SettingYtdlpCookiesFile:       "# cookies",
		},
		Library: lib,
	}))
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	after, _ := e.settings.GetAll(ctx)
	if len(after) != len(before) {
		t.Fatalf("settings rows changed: %d -> %d", len(before), len(after))
	}
	for k, v := range before {
		if after[k] != v {
			t.Errorf("setting %s changed: %q -> %q", k, v, after[k])
		}
	}
	if got := e.mgr.WorkerCount(); got != workersBefore {
		t.Errorf("worker pool changed: %d -> %d", workersBefore, got)
	}
}

func TestFullRestore_SuccessAppliesSettingsLibraryAndEnqueuesWithRestoredSettings(t *testing.T) {
	e := newAtomicEnv(t)
	ctx := context.Background()

	w := e.do(http.MethodPost, "/import/full", sealImport(t, "full", backup.FullBundle{
		Settings: map[string]string{
			models.SettingDefaultQuality:          "480p",
			models.SettingMaxConcurrentTranscodes: "4",
			"library_sort":                        "title:asc", // retired
		},
		Library: backup.LibraryBundle{LibraryItems: []backup.LibraryItemEntry{
			{Title: "ghost", Status: "ghost", DownloadType: "video"},
			{Title: "dl", OriginalURL: "https://example.test/v", DownloadType: "video", Folder: "x"},
		}},
	}))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	var resp BackupRestoreFullResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.SettingsApplied != 2 {
		t.Errorf("settingsApplied = %d, want 2 (retired key skipped)", resp.SettingsApplied)
	}
	if resp.Library.GhostsCreated != 1 || resp.Library.DownloadsQueued != 1 {
		t.Fatalf("library response = %+v", resp.Library)
	}
	if got := e.get(models.SettingDefaultQuality); got != "480p" {
		t.Errorf("default quality = %q", got)
	}
	if got := e.ytdlp.MaxConcurrentTranscodes(); got != 4 {
		t.Errorf("transcodes = %d, want 4", got)
	}
	// The redownload was queued AFTER the settings step, so it picked up the
	// restored default quality rather than the pre-restore one.
	list, err := e.downloads.List(ctx)
	if err != nil || len(list) != 1 {
		t.Fatalf("downloads = %v, err %v", list, err)
	}
	if list[0].Quality != "480p" {
		t.Errorf("redownload quality = %q, want the restored 480p", list[0].Quality)
	}
}

func TestFullRestore_AppliesWorkerPoolFromRestoredSettings(t *testing.T) {
	e := newAtomicEnv(t)
	w := e.do(http.MethodPost, "/import/full", sealImport(t, "full", backup.FullBundle{
		Settings: map[string]string{models.SettingMaxConcurrentDownloads: "5"},
	}))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	if got := e.mgr.WorkerCount(); got != 5 {
		t.Errorf("worker pool = %d, want 5", got)
	}
}

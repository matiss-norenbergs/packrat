package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/backup"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/ratelimit"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/sysevents"
)

// storedEvents returns every stored event, oldest first, with the JSON text of message+details
// joined so tests can assert that forbidden content never appears.
func storedEvents(t *testing.T, repo *repository.SystemEventsRepo) []models.SystemEvent {
	t.Helper()
	items, _, err := repo.Query(context.Background(), repository.SystemEventQuery{Sort: "createdAt", PageSize: 200})
	if err != nil {
		t.Fatal(err)
	}
	return items
}

func eventText(e models.SystemEvent) string { return e.Message + " " + string(e.Details) }

func assertNoneOf(t *testing.T, events []models.SystemEvent, forbidden ...string) {
	t.Helper()
	for _, e := range events {
		for _, bad := range forbidden {
			if bad != "" && strings.Contains(eventText(e), bad) {
				t.Fatalf("%q leaked into %s event: %s", bad, e.Category, eventText(e))
			}
		}
	}
}

func detailsOf(t *testing.T, e models.SystemEvent) map[string]any {
	t.Helper()
	var d map[string]any
	if err := json.Unmarshal(e.Details, &d); err != nil {
		t.Fatalf("details %q: %v", e.Details, err)
	}
	return d
}

// ---- security ----

// Failed logins never create events; the lockout they cause creates exactly one, with the address.
func TestSecurityFailedLoginsRecordNothingAndLockoutRecordsOnce(t *testing.T) {
	env := newAuthTestEnv(t)
	setupAndLogin(t, env.r)

	for i := 0; i < ratelimit.PerIPMaxFailures-1; i++ {
		if w := loginFrom(env, "10.0.0.1:1234", "wrong-password", nil); w.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d", i+1, w.Code)
		}
	}
	if evs := storedEvents(t, env.events); len(evs) != 0 {
		t.Fatalf("failed logins recorded %d events", len(evs))
	}

	// The failure that starts the block is the only one that records.
	loginFrom(env, "10.0.0.1:1234", "wrong-password", nil)
	// Further attempts are refused with 429 and record nothing.
	for i := 0; i < 5; i++ {
		if w := loginFrom(env, "10.0.0.1:1234", "wrong-password", nil); w.Code != http.StatusTooManyRequests {
			t.Fatalf("blocked attempt: %d", w.Code)
		}
	}
	evs := storedEvents(t, env.events)
	if len(evs) != 1 {
		t.Fatalf("want exactly one lockout event, got %d", len(evs))
	}
	if evs[0].Category != "security" || evs[0].Level != "warning" {
		t.Fatalf("%+v", evs[0])
	}
	d := detailsOf(t, evs[0])
	if d["ip"] != "10.0.0.1" || d["blocksEveryone"] != false {
		t.Fatalf("details: %v", d)
	}
	assertNoneOf(t, evs, "wrong-password", "hunter2")
}

func TestSecurityPasswordChangeAndOtherSessions(t *testing.T) {
	env := newAuthTestEnv(t)
	cookies, token := setupAndLogin(t, env.r)
	_ = cookies

	w := authDo(env.r, authReq{method: "PATCH", path: "/api/auth/password", headers: env.bearer(token),
		body: `{"currentPassword":"hunter2-hunter2","newPassword":"brand-new-secret-9"}`})
	if w.Code != http.StatusNoContent {
		t.Fatalf("change password: %d %s", w.Code, w.Body)
	}
	// A wrong current password changes nothing and records nothing.
	w = authDo(env.r, authReq{method: "PATCH", path: "/api/auth/password", headers: env.bearer(token),
		body: `{"currentPassword":"not-the-password","newPassword":"another-secret-99"}`})
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("wrong current password: %d", w.Code)
	}
	evs := storedEvents(t, env.events)
	if len(evs) != 1 || evs[0].Message != "Password changed" || evs[0].Level != "info" || evs[0].Category != "security" {
		t.Fatalf("%+v", evs)
	}
	if detailsOf(t, evs[0])["ip"] == nil {
		t.Fatal("security events carry the client address")
	}
	assertNoneOf(t, evs, "hunter2-hunter2", "brand-new-secret-9", "not-the-password", "another-secret-99", token)

	w = authDo(env.r, authReq{method: "POST", path: "/api/auth/sessions/revoke-others", headers: env.bearer(token), body: `{}`})
	if w.Code != http.StatusOK {
		t.Fatalf("revoke others: %d %s", w.Code, w.Body)
	}
	evs = storedEvents(t, env.events)
	if len(evs) != 2 || evs[1].Message != "Other sessions signed out" {
		t.Fatalf("%+v", evs)
	}
	assertNoneOf(t, evs, token)
}

func TestSecurityTwoFactorEvents(t *testing.T) {
	e := newAuthTestEnv(t)
	_, token := setupAndLogin(t, e.r)
	secret, codes := e.enable2FA(t, token)

	w := e.post("/api/auth/2fa/recovery-codes", `{"password":"hunter2-hunter2","code":"`+e.currentCode(t, secret)+`"}`, token)
	if w.Code != http.StatusOK {
		t.Fatalf("regenerate: %d %s", w.Code, w.Body)
	}
	newCodes := jsonBody[RecoveryCodesResponse](t, w).RecoveryCodes
	if w := e.post("/api/auth/2fa/disable", `{"password":"hunter2-hunter2","recoveryCode":"`+newCodes[0]+`"}`, token); w.Code != http.StatusNoContent {
		t.Fatalf("disable: %d %s", w.Code, w.Body)
	}

	evs := storedEvents(t, e.events)
	want := []struct{ msg, level string }{
		{"Two-factor authentication enabled", "info"},
		{"Recovery codes regenerated", "info"},
		{"Two-factor authentication disabled", "warning"},
	}
	if len(evs) != len(want) {
		t.Fatalf("got %d events: %+v", len(evs), evs)
	}
	for i, w := range want {
		if evs[i].Message != w.msg || evs[i].Level != w.level || evs[i].Category != "security" {
			t.Fatalf("event %d: %+v", i, evs[i])
		}
	}
	forbidden := append(append([]string{secret, "hunter2-hunter2"}, codes...), newCodes...)
	assertNoneOf(t, evs, forbidden...)
}

// ---- restore ----

func TestRestoreSettingsImportRecordsOutcomeWithoutContent(t *testing.T) {
	e := newAtomicEnv(t)
	body := sealImport(t, "settings", map[string]string{models.SettingDefaultQuality: "720p", models.SettingYtdlpProxy: "http://user:proxy-secret@10.1.1.1:3128"})
	if w := e.do(http.MethodPost, "/import/settings", body); w.Code != http.StatusOK {
		t.Fatalf("import: %d %s", w.Code, w.Body)
	}
	evs := storedEvents(t, e.events)
	if len(evs) != 1 || evs[0].Level != "info" || evs[0].Category != "restore" || evs[0].Message != "Settings import completed" {
		t.Fatalf("%+v", evs)
	}
	if detailsOf(t, evs[0])["settingsApplied"] != float64(2) {
		t.Fatalf("details: %s", evs[0].Details)
	}
	assertNoneOf(t, evs, "proxy-secret", "10.1.1.1", "720p")
}

func TestRestoreRefusedWhenPasswordIsWrongOrFileIsGarbage(t *testing.T) {
	e := newAtomicEnv(t)

	plain, _ := json.Marshal(map[string]string{models.SettingDefaultQuality: "720p"})
	env, err := backup.Seal("settings", plain, "correct-horse-battery")
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(env)
	if w := e.do(http.MethodPost, "/import/settings", map[string]any{"data": string(data), "password": "wrong-password-123"}); w.Code == http.StatusOK {
		t.Fatalf("wrong password must be refused: %d", w.Code)
	}
	if w := e.do(http.MethodPost, "/import/full", map[string]any{"data": "this is not a backup file"}); w.Code != http.StatusBadRequest {
		t.Fatalf("garbage: %d", w.Code)
	}

	evs := storedEvents(t, e.events)
	if len(evs) != 2 {
		t.Fatalf("want 2 refusal events, got %+v", evs)
	}
	if evs[0].Message != "Settings import refused" || evs[1].Message != "Full restore from an uploaded file refused" {
		t.Fatalf("%+v", evs)
	}
	for _, ev := range evs {
		if ev.Level != "warning" || ev.Category != "restore" {
			t.Fatalf("%+v", ev)
		}
	}
	assertNoneOf(t, evs, "wrong-password-123", "correct-horse-battery", "this is not a backup file")
	if got, err := e.settings.Get(context.Background(), models.SettingDefaultQuality); err == nil && got == "720p" {
		t.Fatal("a refused import must not apply anything")
	}
}

func TestRestoreFullImportRecordsCounts(t *testing.T) {
	e := newAtomicEnv(t)
	body := sealImport(t, "full", backup.FullBundle{Settings: map[string]string{models.SettingDefaultQuality: "480p"}})
	if w := e.do(http.MethodPost, "/import/full", body); w.Code != http.StatusOK {
		t.Fatalf("import full: %d %s", w.Code, w.Body)
	}
	evs := storedEvents(t, e.events)
	if len(evs) != 1 || evs[0].Message != "Full restore from an uploaded file completed" || evs[0].Level != "info" {
		t.Fatalf("%+v", evs)
	}
	d := detailsOf(t, evs[0])
	if d["settingsApplied"] != float64(1) || d["downloadsQueued"] != float64(0) {
		t.Fatalf("details: %v", d)
	}
}

func TestRestoreFailureIsAnErrorWithMaskedText(t *testing.T) {
	e := newAtomicEnv(t)
	e.router.GET("/boom", func(c *gin.Context) {
		recordRestoreFailed(c, restoreLibraryImport, errors.New("download https://user:hunter2@host.example/x?token=abc123 failed; proxy http://u:p@10.0.0.1:8080"))
		c.Status(http.StatusNoContent)
	})
	e.do(http.MethodGet, "/boom", nil)
	evs := storedEvents(t, e.events)
	if len(evs) != 1 || evs[0].Level != "error" || evs[0].Message != "Library import failed" {
		t.Fatalf("%+v", evs)
	}
	assertNoneOf(t, evs, "hunter2", "abc123", "host.example", "10.0.0.1", "u:p")
}

// ---- maintenance ----

func scanRouter(t *testing.T, e *cleanupEnv, mediaRoot string) (*gin.Engine, *repository.SystemEventsRepo) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	repo := repository.NewSystemEventsRepo(e.conn)
	r := gin.New()
	r.Use(eventsMiddleware(sysevents.New(repo, repository.NewSettingsRepo(e.conn))))
	r.POST("/scan", ScanMissingLibraryFiles(mediaRoot, e.library))
	return r, repo
}

func TestMaintenanceScanMissingRecordsCountsOnly(t *testing.T) {
	e := newCleanupEnv(t)
	e.item(t, "keep/secret-title.mp4", true)
	e.item(t, "gone/other-title.mp4", false)
	r, repo := scanRouter(t, e, e.mediaRoot)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/scan", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("scan: %d %s", w.Code, w.Body)
	}
	evs := storedEvents(t, repo)
	if len(evs) != 1 || evs[0].Category != "maintenance" || evs[0].Level != "info" {
		t.Fatalf("%+v", evs)
	}
	d := detailsOf(t, evs[0])
	if d["scanned"] != float64(2) || d["ghosted"] != float64(1) || d["unreadable"] != float64(0) {
		t.Fatalf("details: %v", d)
	}
	assertNoneOf(t, evs, "secret-title", "other-title", "keep/", "gone/")
}

func TestMaintenanceScanRefusedByMediaRootAndByGuard(t *testing.T) {
	// Missing media folder.
	e := newCleanupEnv(t)
	e.item(t, "a.mp4", true)
	r, repo := scanRouter(t, e, e.mediaRoot+"-does-not-exist")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/scan", nil))
	if w.Code != http.StatusConflict {
		t.Fatalf("status %d", w.Code)
	}
	evs := storedEvents(t, repo)
	if len(evs) != 1 || evs[0].Level != "warning" || !strings.Contains(evs[0].Message, "refused") {
		t.Fatalf("%+v", evs)
	}

	// The mass-clear guard.
	e = newCleanupEnv(t)
	e.item(t, "present.mp4", true)
	for i := 0; i < scanMissingConfirmMinItems; i++ {
		e.item(t, "gone/"+string(rune('a'+i))+".mp4", false)
	}
	r, repo = scanRouter(t, e, e.mediaRoot)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/scan", nil))
	if w.Code != http.StatusConflict {
		t.Fatalf("guard: status %d %s", w.Code, w.Body)
	}
	evs = storedEvents(t, repo)
	if len(evs) != 1 || evs[0].Level != "warning" || !strings.Contains(evs[0].Message, "safety guard") {
		t.Fatalf("%+v", evs)
	}
	if detailsOf(t, evs[0])["wouldGhost"] != float64(scanMissingConfirmMinItems) {
		t.Fatalf("details: %s", evs[0].Details)
	}
}

// ---- yt-dlp ----

func TestYtdlpUpdateFailureIsRecordedAsErrorWithoutURLs(t *testing.T) {
	e := newAtomicEnv(t)
	e.router.POST("/ytdlp/update", UpdateYtDlp(downloader.NewYtDlpService("packrat-missing-yt-dlp", "", "packrat-missing-pip", e.settings, 1)))
	if w := e.do(http.MethodPost, "/ytdlp/update", map[string]any{}); w.Code != http.StatusBadGateway {
		t.Fatalf("status %d %s", w.Code, w.Body)
	}
	evs := storedEvents(t, e.events)
	if len(evs) != 1 || evs[0].Level != "error" || evs[0].Category != "ytdlp" || evs[0].Message != "yt-dlp update failed" {
		t.Fatalf("%+v", evs)
	}
	assertNoneOf(t, evs, "http://", "https://")
}

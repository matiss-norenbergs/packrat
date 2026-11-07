package api

import (
	"context"
	"net/http"
	"os"
	"runtime"
	"testing"

	"packrat/backend/internal/backup"
	"packrat/backend/internal/models"
)

func (e *atomicEnv) cookiesOnDisk() (string, bool) {
	e.t.Helper()
	raw, err := os.ReadFile(e.cookiesPath)
	if os.IsNotExist(err) {
		return "", false
	}
	if err != nil {
		e.t.Fatal(err)
	}
	return string(raw), true
}

func (e *atomicEnv) wantCookies(want string) {
	e.t.Helper()
	got, exists := e.cookiesOnDisk()
	if want == "" {
		if exists {
			e.t.Fatalf("cookies file should not exist, has %q", got)
		}
		return
	}
	if !exists || got != want {
		e.t.Fatalf("cookies file = %q (exists %v), want %q", got, exists, want)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(e.cookiesPath)
		if err != nil {
			e.t.Fatal(err)
		}
		if perm := info.Mode().Perm(); perm != 0o600 {
			e.t.Fatalf("cookies file mode = %o, want 600", perm)
		}
	}
}

func TestCookies_PatchStillWritesAndRemovesFile(t *testing.T) {
	e := newAtomicEnv(t)
	w := e.do(http.MethodPatch, "/settings", map[string]any{"ytdlpCookiesFile": "# Netscape\nfoo"})
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	e.wantCookies("# Netscape\nfoo")

	w = e.do(http.MethodPatch, "/settings", map[string]any{"ytdlpCookiesFile": ""})
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	e.wantCookies("")
}

func TestCookies_PatchRejectedLeavesFileAlone(t *testing.T) {
	e := newAtomicEnv(t)
	w := e.do(http.MethodPatch, "/settings", map[string]any{
		"ytdlpCookiesFile":        "# new",
		"resolutionThresholdLow":  2160,
		"resolutionThresholdHigh": 720,
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", w.Code)
	}
	e.wantCookies("")
}

func TestCookies_PatchWriteFailureIs500AndKeepsSetting(t *testing.T) {
	e := newAtomicEnv(t)
	// A directory where the file should be makes the file write fail.
	if err := os.Mkdir(e.cookiesPath, 0o755); err != nil {
		t.Fatal(err)
	}
	w := e.do(http.MethodPatch, "/settings", map[string]any{"ytdlpCookiesFile": "# c"})
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	if got := e.get(models.SettingYtdlpCookiesFile); got != "# c" {
		t.Fatalf("committed setting should stay saved, got %q", got)
	}
}

func TestCookies_ImportSettingsWritesAndClearsFile(t *testing.T) {
	e := newAtomicEnv(t)
	w := e.do(http.MethodPost, "/import/settings", sealImport(t, "settings", map[string]string{
		models.SettingYtdlpCookiesFile: "# restored",
	}))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	e.wantCookies("# restored")

	w = e.do(http.MethodPost, "/import/settings", sealImport(t, "settings", map[string]string{
		models.SettingYtdlpCookiesFile: "",
	}))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	e.wantCookies("")
}

func TestCookies_FullRestoreWritesAndClearsFile(t *testing.T) {
	e := newAtomicEnv(t)
	w := e.do(http.MethodPost, "/import/full", sealImport(t, "full", backup.FullBundle{
		Settings: map[string]string{models.SettingYtdlpCookiesFile: "# from full"},
	}))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	e.wantCookies("# from full")

	w = e.do(http.MethodPost, "/import/full", sealImport(t, "full", backup.FullBundle{
		Settings: map[string]string{models.SettingYtdlpCookiesFile: ""},
	}))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	e.wantCookies("")
}

func TestCookies_FullRestoreFileFailureDoesNotFailRestore(t *testing.T) {
	e := newAtomicEnv(t)
	if err := os.Mkdir(e.cookiesPath, 0o755); err != nil {
		t.Fatal(err)
	}
	w := e.do(http.MethodPost, "/import/full", sealImport(t, "full", backup.FullBundle{
		Settings: map[string]string{models.SettingYtdlpCookiesFile: "# c"},
	}))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	if got := e.get(models.SettingYtdlpCookiesFile); got != "# c" {
		t.Fatalf("setting = %q", got)
	}
}

func TestCookies_FullRestoreLibraryFailureLeavesFileAlone(t *testing.T) {
	e := newAtomicEnv(t)
	if err := os.WriteFile(e.cookiesPath, []byte("# old"), 0o600); err != nil {
		t.Fatal(err)
	}
	lib := failingLibraryBundle(t, e)
	w := e.do(http.MethodPost, "/import/full", sealImport(t, "full", backup.FullBundle{
		Settings: map[string]string{models.SettingYtdlpCookiesFile: "# new"},
		Library:  lib,
	}))
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", w.Code)
	}
	e.wantCookies("# old")
}

func TestSyncCookiesFile_Startup(t *testing.T) {
	ctx := context.Background()
	e := newAtomicEnv(t)

	// Setting empty, no file: nothing to do.
	if changed, err := SyncCookiesFile(ctx, e.settings, e.ytdlp); err != nil || changed {
		t.Fatalf("empty/empty: changed=%v err=%v", changed, err)
	}

	// Setting non-empty, file missing: created.
	if err := e.settings.Set(ctx, models.SettingYtdlpCookiesFile, "# db"); err != nil {
		t.Fatal(err)
	}
	if changed, err := SyncCookiesFile(ctx, e.settings, e.ytdlp); err != nil || !changed {
		t.Fatalf("missing: changed=%v err=%v", changed, err)
	}
	e.wantCookies("# db")

	// Already matching: no write, nothing reported.
	before, err := os.Stat(e.cookiesPath)
	if err != nil {
		t.Fatal(err)
	}
	if changed, err := SyncCookiesFile(ctx, e.settings, e.ytdlp); err != nil || changed {
		t.Fatalf("matching: changed=%v err=%v", changed, err)
	}
	after, _ := os.Stat(e.cookiesPath)
	if !after.ModTime().Equal(before.ModTime()) {
		t.Fatal("matching file was rewritten")
	}

	// Stale file: replaced.
	if err := os.WriteFile(e.cookiesPath, []byte("# stale"), 0o600); err != nil {
		t.Fatal(err)
	}
	if changed, err := SyncCookiesFile(ctx, e.settings, e.ytdlp); err != nil || !changed {
		t.Fatalf("stale: changed=%v err=%v", changed, err)
	}
	e.wantCookies("# db")

	// Setting empty but a file exists: removed.
	if err := e.settings.Set(ctx, models.SettingYtdlpCookiesFile, ""); err != nil {
		t.Fatal(err)
	}
	if changed, err := SyncCookiesFile(ctx, e.settings, e.ytdlp); err != nil || !changed {
		t.Fatalf("remove: changed=%v err=%v", changed, err)
	}
	e.wantCookies("")
}

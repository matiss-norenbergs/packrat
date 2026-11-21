package api

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"packrat/backend/internal/backup"
	"packrat/backend/internal/models"
)

// subsRestorePath is one endpoint that can change featureSubscriptionsEnabled.
type subsRestorePath struct {
	name string
	// restore performs the restore with the given settings bundle and
	// returns the HTTP status.
	restore func(t *testing.T, e *atomicEnv, settings map[string]string, lib backup.LibraryBundle) int
}

// seedHistoryBackup writes a sealed full backup into the env's backups root
// and registers it in backup history, returning the history id.
func seedHistoryBackup(t *testing.T, e *atomicEnv, bundle backup.FullBundle) int64 {
	t.Helper()
	body := sealImport(t, "full", bundle)
	name := "backup-test.json"
	if err := os.WriteFile(filepath.Join(e.backupsRoot, name), []byte(body["data"].(string)), 0o600); err != nil {
		t.Fatal(err)
	}
	id, err := e.history.Create(context.Background(), models.BackupHistory{
		CreatedAt:   time.Now(),
		TriggerType: "manual",
		Status:      "success",
		FileName:    &name,
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func subsRestorePaths() []subsRestorePath {
	return []subsRestorePath{
		{"history restore", func(t *testing.T, e *atomicEnv, s map[string]string, lib backup.LibraryBundle) int {
			id := seedHistoryBackup(t, e, backup.FullBundle{Settings: s, Library: lib})
			return e.do(http.MethodPost, "/history/"+strconv.FormatInt(id, 10)+"/restore", map[string]any{}).Code
		}},
		{"uploaded full restore", func(t *testing.T, e *atomicEnv, s map[string]string, lib backup.LibraryBundle) int {
			return e.do(http.MethodPost, "/import/full", sealImport(t, "full", backup.FullBundle{Settings: s, Library: lib})).Code
		}},
		{"settings import (settings file)", func(t *testing.T, e *atomicEnv, s map[string]string, lib backup.LibraryBundle) int {
			return e.do(http.MethodPost, "/import/settings", sealImport(t, "settings", s)).Code
		}},
		{"settings import (full file)", func(t *testing.T, e *atomicEnv, s map[string]string, lib backup.LibraryBundle) int {
			return e.do(http.MethodPost, "/import/settings", sealImport(t, "full", backup.FullBundle{Settings: s, Library: lib})).Code
		}},
	}
}

func TestRestore_SubscriptionsCatchUp(t *testing.T) {
	flag := models.SettingFeatureSubscriptionsEnabled
	for _, p := range subsRestorePaths() {
		t.Run(p.name+"/off to on fires once after commit", func(t *testing.T) {
			e := newAtomicEnv(t)
			if err := e.settings.Set(context.Background(), flag, "false"); err != nil {
				t.Fatal(err)
			}
			if code := p.restore(t, e, map[string]string{flag: "true"}, backup.LibraryBundle{}); code != http.StatusOK {
				t.Fatalf("status = %d", code)
			}
			if e.subsFired != 1 {
				t.Fatalf("callback fired %d times, want 1", e.subsFired)
			}
			if len(e.subsSeen) != 1 || e.subsSeen[0] != "true" {
				t.Fatalf("flag when callback fired = %v, want [true] (callback must run after the write)", e.subsSeen)
			}
		})
		t.Run(p.name+"/already on does not fire", func(t *testing.T) {
			e := newAtomicEnv(t)
			if err := e.settings.Set(context.Background(), flag, "true"); err != nil {
				t.Fatal(err)
			}
			if code := p.restore(t, e, map[string]string{flag: "true"}, backup.LibraryBundle{}); code != http.StatusOK {
				t.Fatalf("status = %d", code)
			}
			if e.subsFired != 0 {
				t.Fatalf("callback fired %d times, want 0", e.subsFired)
			}
		})
		t.Run(p.name+"/never set (default on) does not fire", func(t *testing.T) {
			e := newAtomicEnv(t)
			if code := p.restore(t, e, map[string]string{flag: "true"}, backup.LibraryBundle{}); code != http.StatusOK {
				t.Fatalf("status = %d", code)
			}
			if e.subsFired != 0 {
				t.Fatalf("callback fired %d times, want 0", e.subsFired)
			}
		})
		t.Run(p.name+"/bundle leaves it off does not fire", func(t *testing.T) {
			e := newAtomicEnv(t)
			if err := e.settings.Set(context.Background(), flag, "false"); err != nil {
				t.Fatal(err)
			}
			if code := p.restore(t, e, map[string]string{flag: "false"}, backup.LibraryBundle{}); code != http.StatusOK {
				t.Fatalf("status = %d", code)
			}
			if e.subsFired != 0 {
				t.Fatalf("callback fired %d times, want 0", e.subsFired)
			}
			if got := e.get(flag); got != "false" {
				t.Fatalf("flag = %q, want false", got)
			}
		})
		t.Run(p.name+"/on to off does not fire", func(t *testing.T) {
			e := newAtomicEnv(t)
			if err := e.settings.Set(context.Background(), flag, "true"); err != nil {
				t.Fatal(err)
			}
			if code := p.restore(t, e, map[string]string{flag: "false"}, backup.LibraryBundle{}); code != http.StatusOK {
				t.Fatalf("status = %d", code)
			}
			if e.subsFired != 0 {
				t.Fatalf("callback fired %d times, want 0", e.subsFired)
			}
		})
	}
}

// A restore that fails must not run the catch-up: the full-restore paths
// apply the library half first, so a failing library leaves the flag alone.
func TestRestore_SubscriptionsCatchUpSkippedOnFailure(t *testing.T) {
	flag := models.SettingFeatureSubscriptionsEnabled
	for _, p := range subsRestorePaths()[:2] {
		t.Run(p.name, func(t *testing.T) {
			e := newAtomicEnv(t)
			if err := e.settings.Set(context.Background(), flag, "false"); err != nil {
				t.Fatal(err)
			}
			lib := failingLibraryBundle(t, e)
			if code := p.restore(t, e, map[string]string{flag: "true"}, lib); code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500", code)
			}
			if e.subsFired != 0 {
				t.Fatalf("callback fired %d times after a failed restore", e.subsFired)
			}
			if got := e.get(flag); got != "false" {
				t.Fatalf("flag = %q after a failed restore, want false", got)
			}
		})
	}
}

// A refused import (wrong kind of file) is not a restore at all.
func TestImportSettings_SubscriptionsCatchUpSkippedWhenRefused(t *testing.T) {
	e := newAtomicEnv(t)
	flag := models.SettingFeatureSubscriptionsEnabled
	if err := e.settings.Set(context.Background(), flag, "false"); err != nil {
		t.Fatal(err)
	}
	w := e.do(http.MethodPost, "/import/settings", sealImport(t, "library", backup.LibraryBundle{}))
	if w.Code == http.StatusOK {
		t.Fatalf("status = %d, want a refusal", w.Code)
	}
	if e.subsFired != 0 {
		t.Fatalf("callback fired %d times", e.subsFired)
	}
}

// ImportLibrary never touches settings, so it takes no callback; guard that
// the helper itself is a no-op without one.
func TestCatchUpSubscriptions_NilCallbackIsSafe(t *testing.T) {
	e := newAtomicEnv(t)
	catchUpSubscriptions(context.Background(), e.settings, false, nil)
}

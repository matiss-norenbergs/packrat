package api

import (
	"net/http"
	"strconv"
	"strings"
	"testing"

	"packrat/backend/internal/backup"
	"packrat/backend/internal/models"
)

func TestPatchMaxConcurrentDownloadsUpperLimit(t *testing.T) {
	e := newAtomicEnv(t)
	limit := models.MaxConcurrentDownloadsLimit

	w := e.do(http.MethodPatch, "/settings", map[string]any{"maxConcurrentDownloads": limit + 1})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("limit+1: status %d, body %s", w.Code, w.Body)
	}
	if !strings.Contains(w.Body.String(), "maxConcurrentDownloads") || !strings.Contains(w.Body.String(), strconv.Itoa(limit)) {
		t.Errorf("message should name the field and the limit: %s", w.Body)
	}
	if got := e.mgr.WorkerCount(); got != 0 {
		t.Errorf("a rejected PATCH changed the pool to %d", got)
	}

	// The limit itself is fine; 0 is still refused (lower bound unchanged).
	if w := e.do(http.MethodPatch, "/settings", map[string]any{"maxConcurrentDownloads": limit}); w.Code != http.StatusNoContent {
		t.Fatalf("limit: status %d, body %s", w.Code, w.Body)
	}
	if got := e.mgr.WorkerCount(); got != limit {
		t.Errorf("pool = %d, want %d", got, limit)
	}
	if w := e.do(http.MethodPatch, "/settings", map[string]any{"maxConcurrentDownloads": 0}); w.Code != http.StatusBadRequest {
		t.Errorf("0: status %d", w.Code)
	}
}

// A restore must not fail halfway: an out-of-range worker count is clamped.
func TestRestoreClampsMaxConcurrentDownloads(t *testing.T) {
	limit := models.MaxConcurrentDownloadsLimit
	for _, tc := range []struct{ name, path, kind string }{
		{"settings import", "/import/settings", "settings"},
		{"full import", "/import/full", "full"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newAtomicEnv(t)
			settings := map[string]string{models.SettingMaxConcurrentDownloads: "10000000"}
			var payload any = settings
			if tc.kind == "full" {
				payload = backup.FullBundle{Settings: settings}
			}
			w := e.do(http.MethodPost, tc.path, sealImport(t, tc.kind, payload))
			if w.Code != http.StatusOK {
				t.Fatalf("status %d, body %s", w.Code, w.Body)
			}
			if got := e.get(models.SettingMaxConcurrentDownloads); got != strconv.Itoa(limit) {
				t.Errorf("stored value = %q, want %d", got, limit)
			}
			if got := e.mgr.WorkerCount(); got != limit {
				t.Errorf("pool = %d, want %d", got, limit)
			}
		})
	}
}

func TestSetWorkerCountNeverExceedsLimit(t *testing.T) {
	e := newAtomicEnv(t)
	e.mgr.SetWorkerCount(10_000_000)
	if got := e.mgr.WorkerCount(); got != models.MaxConcurrentDownloadsLimit {
		t.Fatalf("pool = %d, want %d", got, models.MaxConcurrentDownloadsLimit)
	}
	e.mgr.SetWorkerCount(3)
	if got := e.mgr.WorkerCount(); got != 3 {
		t.Fatalf("shrink: pool = %d, want 3", got)
	}
}

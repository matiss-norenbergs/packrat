package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

func (e *atomicEnv) withEventsRoute(events *repository.SystemEventsRepo) {
	e.router.PATCH("/settings-ev", UpdateSettings(e.settings, e.mgr, e.ytdlp, events, nil))
}

func TestSystemEventsSettings_PatchValidatesAndStores(t *testing.T) {
	e := newAtomicEnv(t)
	events := repository.NewSystemEventsRepo(e.conn)
	e.withEventsRoute(events)

	if w := e.do(http.MethodPatch, "/settings-ev", map[string]any{"systemEventsRetentionCount": -1}); w.Code != http.StatusBadRequest {
		t.Fatalf("negative count: %d %s", w.Code, w.Body)
	}
	if got, err := e.settings.Get(context.Background(), models.SettingSystemEventsRetentionCount); err == nil {
		t.Fatalf("a rejected request must not write: %q", got)
	}
	if w := e.do(http.MethodPatch, "/settings-ev", map[string]any{"systemEventsRetentionCount": 1000, "featureSystemEventsEnabled": false}); w.Code != http.StatusNoContent {
		t.Fatalf("valid: %d %s", w.Code, w.Body)
	}
	if e.get(models.SettingSystemEventsRetentionCount) != "1000" || e.get(models.SettingFeatureSystemEventsEnabled) != "false" {
		t.Fatal("not stored")
	}
}

func TestSystemEventsSettings_PruneOnSave(t *testing.T) {
	e := newAtomicEnv(t)
	events := repository.NewSystemEventsRepo(e.conn)
	e.withEventsRoute(events)
	ctx := context.Background()
	for i := 0; i < 6; i++ {
		if _, err := e.conn.Exec(`INSERT INTO system_events (created_at, level, category, message) VALUES (?, 'info', 'startup', 'e')`,
			time.Date(2026, 1, 1+i, 0, 0, 0, 0, time.UTC).Format("2006-01-02 15:04:05")); err != nil {
			t.Fatal(err)
		}
	}
	total := func() int {
		_, n, err := events.Query(ctx, repository.SystemEventQuery{})
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	// Unlimited never prunes.
	if w := e.do(http.MethodPatch, "/settings-ev", map[string]any{"systemEventsRetentionCount": 0}); w.Code != http.StatusNoContent {
		t.Fatal(w.Body)
	}
	if total() != 6 {
		t.Fatalf("Unlimited pruned: %d", total())
	}
	// Lowering the count prunes straight away.
	if w := e.do(http.MethodPatch, "/settings-ev", map[string]any{"systemEventsRetentionCount": 4}); w.Code != http.StatusNoContent {
		t.Fatal(w.Body)
	}
	if total() != 4 {
		t.Fatalf("after lowering to 4: %d", total())
	}
	// A save that does not touch the count leaves events alone.
	if w := e.do(http.MethodPatch, "/settings-ev", map[string]any{"featureSystemEventsEnabled": false}); w.Code != http.StatusNoContent {
		t.Fatal(w.Body)
	}
	if total() != 4 {
		t.Fatalf("unrelated save changed events: %d", total())
	}
}

func TestSystemEventsSettings_GetReturnsBothFields(t *testing.T) {
	e := newAtomicEnv(t)
	e.router.GET("/settings", GetSettings(e.settings, e.mgr, e.ytdlp, ""))
	var resp struct {
		On    bool `json:"featureSystemEventsEnabled"`
		Count int  `json:"systemEventsRetentionCount"`
	}
	get := func() {
		w := e.do(http.MethodGet, "/settings", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
		resp.On, resp.Count = false, -1
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
	}
	get()
	if !resp.On || resp.Count != 0 {
		t.Fatalf("defaults must be on / Unlimited: %+v", resp)
	}
	ctx := context.Background()
	_ = e.settings.Set(ctx, models.SettingFeatureSystemEventsEnabled, "false")
	_ = e.settings.Set(ctx, models.SettingSystemEventsRetentionCount, "5000")
	get()
	if resp.On || resp.Count != 5000 {
		t.Fatalf("stored values: %+v", resp)
	}
}

package sysevents

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

type env struct {
	conn     *sql.DB
	repo     *repository.SystemEventsRepo
	settings *repository.SettingsRepo
	rec      *Recorder
	clock    *fakeClock
}

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func newEnv(t *testing.T) *env {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	dir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	e := &env{conn: conn, repo: repository.NewSystemEventsRepo(conn), settings: repository.NewSettingsRepo(conn), clock: &fakeClock{t: time.Unix(1_700_000_000, 0)}}
	e.rec = New(e.repo, e.settings)
	e.rec.SetClock(e.clock.now)
	return e
}

func (e *env) events(t *testing.T) []models.SystemEvent {
	t.Helper()
	items, _, err := e.repo.Query(context.Background(), repository.SystemEventQuery{Desc: true, PageSize: 200})
	if err != nil {
		t.Fatal(err)
	}
	return items
}

func TestRecord_WritesWhenSettingNeverWritten(t *testing.T) {
	e := newEnv(t)
	e.rec.Record(context.Background(), LevelInfo, CategoryStartup, "Packrat started", map[string]any{"appVersion": "1.2.3", "n": 4})
	items := e.events(t)
	if len(items) != 1 || items[0].Level != "info" || items[0].Category != "startup" || items[0].Message != "Packrat started" {
		t.Fatalf("%+v", items)
	}
	var d map[string]any
	if err := json.Unmarshal(items[0].Details, &d); err != nil || d["appVersion"] != "1.2.3" || d["n"] != float64(4) {
		t.Fatalf("details: %s %v", items[0].Details, err)
	}
}

func TestRecord_NoOpWhenOff(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if err := e.settings.Set(ctx, models.SettingFeatureSystemEventsEnabled, "false"); err != nil {
		t.Fatal(err)
	}
	e.rec.Record(ctx, LevelInfo, CategoryStartup, "off", nil)
	if n := len(e.events(t)); n != 0 {
		t.Fatalf("recorded %d while off", n)
	}
	if err := e.settings.Set(ctx, models.SettingFeatureSystemEventsEnabled, "true"); err != nil {
		t.Fatal(err)
	}
	e.rec.Record(ctx, LevelInfo, CategoryStartup, "on", nil)
	if n := len(e.events(t)); n != 1 {
		t.Fatalf("recorded %d after turning on", n)
	}
}

func TestRecord_NilRecorderIsFine(t *testing.T) {
	var r *Recorder
	r.Record(context.Background(), LevelInfo, CategoryStartup, "x", nil)
	(&Recorder{}).Record(context.Background(), LevelInfo, CategoryStartup, "x", nil)
}

func TestRecord_WriteErrorDoesNotPropagate(t *testing.T) {
	e := newEnv(t)
	e.conn.Close() // every write now fails
	e.rec.Record(context.Background(), LevelError, CategoryBackup, "x", nil)
	// The failed write must not poison the flood guard: a retry is attempted, not dropped.
	e.rec.mu.Lock()
	n := len(e.rec.recent)
	e.rec.mu.Unlock()
	if n != 0 {
		t.Fatalf("failed write left %d flood entries", n)
	}
}

func TestRecord_CancelledContextStillWrites(t *testing.T) {
	e := newEnv(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	e.rec.Record(ctx, LevelInfo, CategoryShutdown, "Shut down cleanly", nil)
	if n := len(e.events(t)); n != 1 {
		t.Fatalf("got %d events", n)
	}
}

func TestRecord_InvalidLevelIsSwallowed(t *testing.T) {
	e := newEnv(t)
	e.rec.Record(context.Background(), "fatal", CategoryBackup, "x", nil)
	if n := len(e.events(t)); n != 0 {
		t.Fatalf("got %d events", n)
	}
}

func TestFloodGuard(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	rec := func(level, cat, msg string) { e.rec.Record(ctx, level, cat, msg, nil) }

	rec(LevelError, CategoryBackup, "Scheduled backup failed")
	e.clock.advance(30 * time.Second)
	rec(LevelError, CategoryBackup, "Scheduled backup failed") // identical, inside the window: dropped
	rec(LevelError, CategoryBackup, "Scheduled backup failed")
	rec(LevelError, CategoryBackup, "A different message")
	rec(LevelWarning, CategoryBackup, "Scheduled backup failed") // different level
	rec(LevelError, CategoryYtdlp, "Scheduled backup failed")    // different category
	if n := len(e.events(t)); n != 4 {
		t.Fatalf("inside the window: %d events, want 4", n)
	}
	e.clock.advance(31 * time.Second) // 61 s after the first
	rec(LevelError, CategoryBackup, "Scheduled backup failed")
	if n := len(e.events(t)); n != 5 {
		t.Fatalf("after the window: %d events, want 5", n)
	}
}

func TestFloodGuard_LogsOncePerWindow(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		e.rec.Record(ctx, LevelError, CategoryBackup, "boom", nil)
	}
	e.rec.mu.Lock()
	defer e.rec.mu.Unlock()
	for _, entry := range e.rec.recent {
		if !entry.logged {
			t.Fatal("the drop line must be logged (once) when repeats are dropped")
		}
	}
}

func TestFloodGuard_SweepsExpiredEntries(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	for i := 0; i < sweepAt; i++ {
		e.rec.Record(ctx, LevelInfo, CategoryStartup, "m"+strings.Repeat("x", i), nil)
	}
	e.clock.advance(2 * FloodWindow)
	e.rec.Record(ctx, LevelInfo, CategoryStartup, "fresh", nil)
	e.rec.mu.Lock()
	defer e.rec.mu.Unlock()
	if len(e.rec.recent) > 2 {
		t.Fatalf("expired entries not swept: %d", len(e.rec.recent))
	}
}

func TestRecord_ConcurrentUse(t *testing.T) {
	e := newEnv(t)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 5; j++ {
				e.rec.Record(context.Background(), LevelInfo, CategoryStartup, "same message", nil)
				e.rec.Record(context.Background(), LevelInfo, CategoryStartup, "message "+string(rune('a'+i)), nil)
			}
		}(i)
	}
	wg.Wait()
	if n := len(e.events(t)); n != 21 { // one "same message" + 20 distinct
		t.Fatalf("got %d events, want 21", n)
	}
}

func TestRecord_ScrubsURLsInMessageAndDetails(t *testing.T) {
	e := newEnv(t)
	e.rec.Record(context.Background(), LevelError, CategoryRestore, "Import failed for https://example.com/watch?v=abc",
		map[string]any{
			"error":  "GET https://user:pw@example.com/x?token=abc: refused",
			"nested": map[string]any{"u": "see http://a.b/c"},
			"list":   []string{"ftp://h/f"},
			"count":  3,
		})
	items := e.events(t)
	if len(items) != 1 {
		t.Fatal("not recorded")
	}
	all := items[0].Message + string(items[0].Details)
	for _, bad := range []string{"example.com", "token=abc", "user:pw", "a.b/c", "ftp://", "http"} {
		if strings.Contains(all, bad) {
			t.Fatalf("%q leaked: %s", bad, all)
		}
	}
	if !strings.Contains(all, "[url]") || !strings.Contains(string(items[0].Details), `"count":3`) {
		t.Fatalf("unexpected: %s", all)
	}
}

func TestRecord_LongStringsAreCapped(t *testing.T) {
	e := newEnv(t)
	e.rec.Record(context.Background(), LevelError, CategoryBackup, strings.Repeat("a", 5000), map[string]any{"e": strings.Repeat("b", 5000)})
	it := e.events(t)[0]
	if len(it.Message) > maxStringLen+8 || len(it.Details) > maxStringLen+64 {
		t.Fatalf("not capped: %d %d", len(it.Message), len(it.Details))
	}
}

func TestPruneAndRetentionCount(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		e.clock.advance(time.Second)
		e.rec.Record(ctx, LevelInfo, CategoryStartup, "m"+string(rune('a'+i)), nil)
	}
	if got := RetentionCount(ctx, e.settings); got != 0 {
		t.Fatalf("default retention %d", got)
	}
	Prune(ctx, e.repo, e.settings) // Unlimited
	if n := len(e.events(t)); n != 5 {
		t.Fatalf("Unlimited pruned: %d", n)
	}
	for _, bad := range []string{"-3", "abc"} {
		_ = e.settings.Set(ctx, models.SettingSystemEventsRetentionCount, bad)
		if got := RetentionCount(ctx, e.settings); got != 0 {
			t.Fatalf("%q -> %d", bad, got)
		}
	}
	_ = e.settings.Set(ctx, models.SettingSystemEventsRetentionCount, "2")
	Prune(ctx, e.repo, e.settings)
	if n := len(e.events(t)); n != 2 {
		t.Fatalf("after prune: %d", n)
	}
	Prune(ctx, nil, e.settings) // nil repo is a no-op
}

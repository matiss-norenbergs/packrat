package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"packrat/backend/internal/db"
)

func openSystemEventsDB(t *testing.T) (*SystemEventsRepo, *sql.DB) {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatalf("opening test db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	dir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(conn, dir); err != nil {
		t.Fatalf("migrating: %v", err)
	}
	return NewSystemEventsRepo(conn), conn
}

// seedEvent inserts an event with an explicit timestamp.
func seedEvent(t *testing.T, conn *sql.DB, at, level, category, message string) int64 {
	t.Helper()
	res, err := conn.Exec(`INSERT INTO system_events (created_at, level, category, message) VALUES (?, ?, ?, ?)`, at, level, category, message)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

func TestSystemEvents_Create(t *testing.T) {
	repo, _ := openSystemEventsDB(t)
	ctx := context.Background()
	id, err := repo.Create(ctx, "warning", "backup", "Backup failed", json.RawMessage(`{"count":3}`))
	if err != nil || id == 0 {
		t.Fatalf("Create: %d %v", id, err)
	}
	if _, err := repo.Create(ctx, "info", "startup", "Started", nil); err != nil {
		t.Fatal(err)
	}
	items, total, err := repo.Query(ctx, SystemEventQuery{Desc: true})
	if err != nil || total != 2 || len(items) != 2 {
		t.Fatalf("Query: %v total=%d len=%d", err, total, len(items))
	}
	byMsg := map[string]string{}
	for _, e := range items {
		byMsg[e.Message] = string(e.Details)
		if e.CreatedAt.IsZero() || time.Since(e.CreatedAt) > time.Minute {
			t.Fatalf("created_at not parsed: %v", e.CreatedAt)
		}
	}
	if byMsg["Backup failed"] != `{"count":3}` || byMsg["Started"] != "" {
		t.Fatalf("details: %v", byMsg)
	}
	if _, err := repo.Create(ctx, "bogus", "x", "y", nil); err == nil {
		t.Fatal("invalid level must be rejected by the CHECK constraint")
	}
}

func TestSystemEvents_QueryFilters(t *testing.T) {
	repo, conn := openSystemEventsDB(t)
	ctx := context.Background()
	seedEvent(t, conn, "2026-01-01 10:00:00", "info", "startup", "Packrat started")
	seedEvent(t, conn, "2026-01-02 10:00:00", "warning", "backup", "Scheduled backup failed")
	seedEvent(t, conn, "2026-01-03 10:00:00", "error", "ytdlp", "yt-dlp update failed")
	seedEvent(t, conn, "2026-01-04 10:00:00", "info", "security", "Password changed")

	count := func(q SystemEventQuery) int {
		t.Helper()
		_, total, err := repo.Query(ctx, q)
		if err != nil {
			t.Fatal(err)
		}
		return total
	}
	if n := count(SystemEventQuery{Levels: []string{"info"}}); n != 2 {
		t.Fatalf("single level: %d", n)
	}
	if n := count(SystemEventQuery{Levels: []string{"warning", "error"}}); n != 2 {
		t.Fatalf("multiple levels: %d", n)
	}
	if n := count(SystemEventQuery{Categories: []string{"backup"}}); n != 1 {
		t.Fatalf("single category: %d", n)
	}
	if n := count(SystemEventQuery{Categories: []string{"backup", "ytdlp", "nope"}}); n != 2 {
		t.Fatalf("multiple categories: %d", n)
	}
	if n := count(SystemEventQuery{Levels: []string{"info"}, Categories: []string{"security"}}); n != 1 {
		t.Fatalf("level+category: %d", n)
	}
	if n := count(SystemEventQuery{Text: "FAILED"}); n != 2 {
		t.Fatalf("case-insensitive text: %d", n)
	}
	if n := count(SystemEventQuery{Text: "%"}); n != 0 {
		t.Fatalf("LIKE wildcards must be literal: %d", n)
	}
	from := time.Date(2026, 1, 2, 10, 0, 0, 0, time.UTC)
	before := time.Date(2026, 1, 4, 10, 0, 0, 0, time.UTC)
	if n := count(SystemEventQuery{From: &from}); n != 3 {
		t.Fatalf("from is inclusive: %d", n)
	}
	if n := count(SystemEventQuery{From: &from, Before: &before}); n != 2 {
		t.Fatalf("before is exclusive: %d", n)
	}
	if n := count(SystemEventQuery{Text: "failed", Levels: []string{"error"}, From: &from}); n != 1 {
		t.Fatalf("combined: %d", n)
	}
}

func TestSystemEvents_SortAllowlistAndTiebreak(t *testing.T) {
	repo, conn := openSystemEventsDB(t)
	ctx := context.Background()
	a := seedEvent(t, conn, "2026-01-01 10:00:00", "warning", "backup", "a")
	b := seedEvent(t, conn, "2026-01-01 10:00:00", "info", "startup", "b") // same second as a
	c := seedEvent(t, conn, "2026-01-02 10:00:00", "error", "ytdlp", "c")

	ids := func(q SystemEventQuery) []int64 {
		t.Helper()
		items, _, err := repo.Query(ctx, q)
		if err != nil {
			t.Fatal(err)
		}
		out := make([]int64, len(items))
		for i, e := range items {
			out[i] = e.ID
		}
		return out
	}
	eq := func(got, want []int64) {
		t.Helper()
		if len(got) != len(want) {
			t.Fatalf("got %v want %v", got, want)
		}
		for i := range got {
			if got[i] != want[i] {
				t.Fatalf("got %v want %v", got, want)
			}
		}
	}
	eq(ids(SystemEventQuery{Sort: "createdAt", Desc: true}), []int64{c, b, a}) // id breaks the tie, newest first
	eq(ids(SystemEventQuery{Sort: "createdAt"}), []int64{a, b, c})
	eq(ids(SystemEventQuery{Sort: "level"}), []int64{c, b, a}) // error, info, warning
	eq(ids(SystemEventQuery{Sort: "category", Desc: true}), []int64{c, b, a})
	// Anything outside the allowlist falls back to createdAt and never reaches SQL.
	eq(ids(SystemEventQuery{Sort: "id; DROP TABLE system_events", Desc: true}), []int64{c, b, a})
	if !ValidSystemEventSort("level") || ValidSystemEventSort("message") {
		t.Fatal("allowlist")
	}
}

func TestSystemEvents_Pagination(t *testing.T) {
	repo, conn := openSystemEventsDB(t)
	ctx := context.Background()
	for i := 0; i < 7; i++ {
		seedEvent(t, conn, time.Date(2026, 1, 1+i, 0, 0, 0, 0, time.UTC).Format(systemEventsTimeLayout), "info", "startup", "e")
	}
	items, total, err := repo.Query(ctx, SystemEventQuery{Desc: true, Page: 2, PageSize: 3})
	if err != nil || total != 7 || len(items) != 3 {
		t.Fatalf("page 2: %v total=%d len=%d", err, total, len(items))
	}
	if !items[0].CreatedAt.After(items[1].CreatedAt) {
		t.Fatal("not newest first")
	}
	items, total, _ = repo.Query(ctx, SystemEventQuery{Desc: true, Page: 3, PageSize: 3})
	if total != 7 || len(items) != 1 {
		t.Fatalf("last page: total=%d len=%d", total, len(items))
	}
	items, total, _ = repo.Query(ctx, SystemEventQuery{Page: 9, PageSize: 3})
	if total != 7 || len(items) != 0 {
		t.Fatalf("past the end: total=%d len=%d", total, len(items))
	}
}

func TestSystemEvents_Facets(t *testing.T) {
	repo, conn := openSystemEventsDB(t)
	seedEvent(t, conn, "2026-01-01 10:00:00", "info", "startup", "a")
	seedEvent(t, conn, "2026-01-01 10:00:01", "info", "startup", "b")
	seedEvent(t, conn, "2026-01-01 10:00:02", "error", "ytdlp", "c")
	levels, cats, err := repo.Facets(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(levels) != 2 || levels[0] != (SystemEventFacet{"error", 1}) || levels[1] != (SystemEventFacet{"info", 2}) {
		t.Fatalf("levels: %+v", levels)
	}
	if len(cats) != 2 || cats[0] != (SystemEventFacet{"startup", 2}) || cats[1] != (SystemEventFacet{"ytdlp", 1}) {
		t.Fatalf("categories: %+v", cats)
	}
	empty, _ := openSystemEventsDB(t)
	l, c, err := empty.Facets(context.Background())
	if err != nil || l == nil || c == nil || len(l) != 0 || len(c) != 0 {
		t.Fatalf("empty facets must be empty non-nil slices: %v %v %v", l, c, err)
	}
}

func TestSystemEvents_DeleteByIDs(t *testing.T) {
	repo, conn := openSystemEventsDB(t)
	ctx := context.Background()
	a := seedEvent(t, conn, "2026-01-01 10:00:00", "info", "startup", "a")
	b := seedEvent(t, conn, "2026-01-01 10:00:01", "info", "startup", "b")
	c := seedEvent(t, conn, "2026-01-01 10:00:02", "info", "startup", "c")

	n, err := repo.DeleteByIDs(ctx, []int64{a, b, 9999})
	if err != nil || n != 2 {
		t.Fatalf("delete: %d %v (ids that do not exist are ignored)", n, err)
	}
	items, total, _ := repo.Query(ctx, SystemEventQuery{})
	if total != 1 || items[0].ID != c {
		t.Fatalf("remaining: %+v", items)
	}
	if n, err := repo.DeleteByIDs(ctx, nil); err != nil || n != 0 {
		t.Fatalf("empty: %d %v", n, err)
	}

	// More ids than one chunk still works, in one transaction.
	var many []int64
	for i := 0; i < inChunkSize+10; i++ {
		many = append(many, int64(100000+i))
	}
	many = append(many, c)
	if n, err := repo.DeleteByIDs(ctx, many); err != nil || n != 1 {
		t.Fatalf("chunked delete: %d %v", n, err)
	}
}

func TestSystemEvents_DeleteByIDsIsAllOrNothing(t *testing.T) {
	repo, conn := openSystemEventsDB(t)
	ctx := context.Background()
	var ids []int64
	for i := 0; i < inChunkSize+5; i++ {
		ids = append(ids, seedEvent(t, conn, "2026-01-01 10:00:00", "info", "startup", "e"))
	}
	// A trigger makes the second chunk's delete fail after the first chunk already ran.
	if _, err := conn.Exec(`CREATE TRIGGER fail_second BEFORE DELETE ON system_events
		WHEN OLD.id = ` + itoa(ids[len(ids)-1]) + ` BEGIN SELECT RAISE(ABORT, 'boom'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteByIDs(ctx, ids); err == nil {
		t.Fatal("expected an error")
	}
	_, total, _ := repo.Query(ctx, SystemEventQuery{})
	if total != len(ids) {
		t.Fatalf("first chunk was not rolled back: %d of %d left", total, len(ids))
	}
}

func itoa(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func TestSystemEvents_DeleteAll(t *testing.T) {
	repo, conn := openSystemEventsDB(t)
	ctx := context.Background()
	seedEvent(t, conn, "2026-01-01 10:00:00", "info", "startup", "a")
	seedEvent(t, conn, "2026-01-01 10:00:01", "info", "startup", "b")
	n, err := repo.DeleteAll(ctx)
	if err != nil || n != 2 {
		t.Fatalf("DeleteAll: %d %v", n, err)
	}
	if _, total, _ := repo.Query(ctx, SystemEventQuery{}); total != 0 {
		t.Fatalf("left %d", total)
	}
}

func TestSystemEvents_PruneToCount(t *testing.T) {
	repo, conn := openSystemEventsDB(t)
	ctx := context.Background()
	var ids []int64
	for i := 0; i < 6; i++ {
		ids = append(ids, seedEvent(t, conn, time.Date(2026, 1, 1+i, 0, 0, 0, 0, time.UTC).Format(systemEventsTimeLayout), "info", "startup", "e"))
	}
	if n, err := repo.PruneToCount(ctx, 0); err != nil || n != 0 {
		t.Fatalf("0 is Unlimited and never prunes: %d %v", n, err)
	}
	if _, total, _ := repo.Query(ctx, SystemEventQuery{}); total != 6 {
		t.Fatalf("pruned on 0: %d", total)
	}
	if n, err := repo.PruneToCount(ctx, 100); err != nil || n != 0 {
		t.Fatalf("above count: %d %v", n, err)
	}
	n, err := repo.PruneToCount(ctx, 2)
	if err != nil || n != 4 {
		t.Fatalf("prune: %d %v", n, err)
	}
	items, _, _ := repo.Query(ctx, SystemEventQuery{Desc: true})
	if len(items) != 2 || items[0].ID != ids[5] || items[1].ID != ids[4] {
		t.Fatalf("must keep the newest two: %+v", items)
	}
}

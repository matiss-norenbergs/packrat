package repository

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
)

func TestCreateWithSeenEntriesIsAllOrNothing(t *testing.T) {
	ctx := context.Background()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatal(err)
	}
	subs := NewSubscriptionsRepo(conn)
	count := func(table string) int {
		var n int
		if err := conn.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	mk := func() *models.Subscription {
		return &models.Subscription{URL: "https://example.test/c", Title: "t", MediaType: "video", CheckIntervalHours: 6, Enabled: true}
	}

	good := []SeenEntryInput{{SourceID: "a", URL: "u"}, {SourceID: "b", URL: "u"}}
	id, err := subs.CreateWithSeenEntries(ctx, mk(), good, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	got, err := subs.Get(ctx, id)
	if err != nil || got.LastCheckedAt == nil {
		t.Fatalf("subscription missing or unchecked: %v %+v", err, got)
	}
	if count("subscriptions") != 1 || count("subscription_seen_entries") != 2 {
		t.Fatalf("after success: subs=%d seen=%d, want 1/2", count("subscriptions"), count("subscription_seen_entries"))
	}

	// The 3rd insert violates UNIQUE (subscription_id, source_id): the whole
	// transaction, including the subscription row, must roll back.
	bad := []SeenEntryInput{{SourceID: "x", URL: "u"}, {SourceID: "y", URL: "u"}, {SourceID: "x", URL: "u"}}
	if _, err := subs.CreateWithSeenEntries(ctx, mk(), bad, time.Now()); err == nil {
		t.Fatal("expected an error")
	}
	if count("subscriptions") != 1 || count("subscription_seen_entries") != 2 {
		t.Fatalf("after failure: subs=%d seen=%d, want 1/2 (nothing left behind)", count("subscriptions"), count("subscription_seen_entries"))
	}
}

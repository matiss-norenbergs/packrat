package subscriptions

import (
	"context"
	"path/filepath"
	"testing"

	"packrat/backend/internal/db"
	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
)

// With the Subscriptions feature off, RunDueChecks must not touch a due
// subscription at all (CheckOne would dereference the nil YtDlp/Manager here
// and panic), and must leave it unchecked so it runs on re-enable.
func TestRunDueChecksSkipsWhileFeatureOff(t *testing.T) {
	ctx := context.Background()
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

	subs := repository.NewSubscriptionsRepo(conn)
	settings := repository.NewSettingsRepo(conn)
	id, err := subs.Create(ctx, &models.Subscription{
		URL: "https://example.com/channel", Title: "t", MediaType: "video",
		CheckIntervalHours: 6, Enabled: true,
	})
	if err != nil {
		t.Fatalf("creating subscription: %v", err)
	}
	if err := settings.Set(ctx, models.SettingFeatureSubscriptionsEnabled, "false"); err != nil {
		t.Fatal(err)
	}

	RunDueChecks(ctx, CheckDeps{SubscriptionsRepo: subs, SettingsRepo: settings})

	got, err := subs.Get(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if got.LastCheckedAt != nil {
		t.Fatalf("expected the subscription to stay unchecked while the feature is off, got LastCheckedAt=%v", got.LastCheckedAt)
	}
}

// An entry whose URL is not http(s) is skipped, and the rest of the batch is
// still processed.
func TestProcessEntriesSkipsNonHTTPURL(t *testing.T) {
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
	subs := repository.NewSubscriptionsRepo(conn)
	downloads := repository.NewDownloadsRepo(conn)
	mgr := queue.NewDownloadManager("", "", "", nil, downloads, nil, nil, nil, nil, nil, nil, nil, nil, nil, queue.NewProgressStore(), ws.NoopBroadcaster{})
	sub := models.Subscription{URL: "https://example.test/c", Title: "t", MediaType: "video", CheckIntervalHours: 6, Enabled: true, AutoDownload: true}
	id, err := subs.Create(ctx, &sub)
	if err != nil {
		t.Fatal(err)
	}
	sub.ID = id

	deps := CheckDeps{SubscriptionsRepo: subs, Manager: mgr, CollectionsRepo: repository.NewCollectionsRepo(conn)}
	entries := []downloader.PlaylistEntry{
		{ID: "bad", Title: "bad", URL: "-example"},
		{ID: "good", Title: "good", URL: "https://example.test/v"},
	}
	n, err := processEntries(ctx, deps, sub, entries, false)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("new count = %d, want 1", n)
	}
	rows, _ := downloads.List(ctx)
	if len(rows) != 1 || rows[0].URL != "https://example.test/v" {
		t.Fatalf("unexpected downloads: %+v", rows)
	}
}

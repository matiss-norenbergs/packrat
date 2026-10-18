package subscriptions

import (
	"context"
	"path/filepath"
	"testing"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
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

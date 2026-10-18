package features

import (
	"context"
	"path/filepath"
	"testing"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

func newSettingsRepo(t *testing.T) *repository.SettingsRepo {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatalf("opening test db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatalf("resolving migrations dir: %v", err)
	}
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatalf("migrating test db: %v", err)
	}
	return repository.NewSettingsRepo(conn)
}

func TestEnabled(t *testing.T) {
	ctx := context.Background()
	repo := newSettingsRepo(t)
	key := models.SettingFeatureSubscriptionsEnabled

	t.Run("defaults to on when never set", func(t *testing.T) {
		if !Enabled(ctx, repo, key) {
			t.Fatal("expected a feature with no stored setting to be enabled")
		}
	})

	t.Run("off when set to false, on again when set to true", func(t *testing.T) {
		if err := repo.Set(ctx, key, "false"); err != nil {
			t.Fatal(err)
		}
		if Enabled(ctx, repo, key) {
			t.Fatal("expected the feature to be disabled")
		}
		if err := repo.Set(ctx, key, "true"); err != nil {
			t.Fatal(err)
		}
		if !Enabled(ctx, repo, key) {
			t.Fatal("expected the feature to be enabled again")
		}
	})

	t.Run("an unparseable value leaves the feature on", func(t *testing.T) {
		if err := repo.Set(ctx, key, "garbage"); err != nil {
			t.Fatal(err)
		}
		if !Enabled(ctx, repo, key) {
			t.Fatal("expected a corrupt value to fail open")
		}
	})

	t.Run("a nil repo means always on", func(t *testing.T) {
		if !Enabled(ctx, nil, key) {
			t.Fatal("expected nil repo to be enabled")
		}
	})

	t.Run("features are independent", func(t *testing.T) {
		if err := repo.Set(ctx, models.SettingFeatureFrameMatchingEnabled, "false"); err != nil {
			t.Fatal(err)
		}
		if !Enabled(ctx, repo, models.SettingFeatureCompareListEnabled) {
			t.Fatal("turning Frame Matching off must not affect the Compare list")
		}
	})
}

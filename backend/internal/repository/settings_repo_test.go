package repository

import (
	"context"
	"errors"
	"testing"

	"packrat/backend/internal/models"
)

func TestSettingsRepo_CRUD(t *testing.T) {
	ctx := context.Background()
	downloadsRepo := openTestDB(t)
	repo := NewSettingsRepo(downloadsRepo.db)

	dq, err := repo.Get(ctx, models.SettingDefaultQuality)
	if err != nil {
		t.Fatalf("Get default_quality: %v", err)
	}
	if dq != "best" {
		t.Fatalf("expected seeded 'best', got %q", dq)
	}

	ddt, err := repo.Get(ctx, models.SettingDefaultDownloadType)
	if err != nil {
		t.Fatalf("Get default_download_type: %v", err)
	}
	if ddt != "video" {
		t.Fatalf("expected seeded 'video', got %q", ddt)
	}

	if err := repo.Set(ctx, models.SettingDefaultQuality, "1080p"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	dq, err = repo.Get(ctx, models.SettingDefaultQuality)
	if err != nil {
		t.Fatal(err)
	}
	if dq != "1080p" {
		t.Fatalf("Set did not persist, got %q", dq)
	}

	if _, err := repo.Get(ctx, "nonexistent_key"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}

	all, err := repo.GetAll(ctx)
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if len(all) != 4 {
		t.Fatalf("expected 4 seeded settings, got %d: %+v", len(all), all)
	}
}

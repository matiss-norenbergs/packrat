package repository

import (
	"context"
	"errors"
	"testing"

	"packrat/backend/internal/models"
)

func TestLibraryRepo_CRUDAndActions(t *testing.T) {
	ctx := context.Background()
	downloadsRepo := openTestDB(t)
	repo := NewLibraryRepo(downloadsRepo.db)
	collectionsRepo := NewCollectionsRepo(downloadsRepo.db)

	id, err := repo.Create(ctx, &models.LibraryItem{
		Title: "Original Title", Filename: "video.mp4", Path: "video.mp4",
		OriginalURL: "https://example.com/x", Status: "completed",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if id == 0 {
		t.Fatalf("expected nonzero id")
	}

	if _, err := repo.Get(ctx, 99999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for unknown id, got %v", err)
	}

	if err := repo.UpdateTitle(ctx, id, "New Title"); err != nil {
		t.Fatalf("UpdateTitle: %v", err)
	}
	got, err := repo.Get(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "New Title" {
		t.Fatalf("UpdateTitle did not persist: %+v", got)
	}

	thumb := "thumb.jpg"
	if err := repo.UpdateFilename(ctx, id, "renamed.mp4", "renamed.mp4", &thumb); err != nil {
		t.Fatalf("UpdateFilename: %v", err)
	}
	got, err = repo.Get(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if got.Filename != "renamed.mp4" || got.Path != "renamed.mp4" || got.Thumbnail == nil || *got.Thumbnail != "thumb.jpg" {
		t.Fatalf("UpdateFilename did not persist: %+v", got)
	}

	collectionID, err := collectionsRepo.Create(ctx, &models.Collection{
		Name: "Music", RootPath: "Music", DefaultQuality: "best", DefaultDownloadType: "audio",
	})
	if err != nil {
		t.Fatalf("creating test collection: %v", err)
	}
	newThumb := "Music/renamed.jpg"
	if err := repo.UpdateLocation(ctx, id, &collectionID, "Music", "renamed.mp4", "Music/renamed.mp4", &newThumb); err != nil {
		t.Fatalf("UpdateLocation: %v", err)
	}
	got, err = repo.Get(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if got.Folder != "Music" || got.Path != "Music/renamed.mp4" || got.CollectionID == nil || *got.CollectionID != collectionID {
		t.Fatalf("UpdateLocation did not persist: %+v", got)
	}
	if got.CollectionName == nil || *got.CollectionName != "Music" {
		t.Fatalf("expected joined collection name, got %+v", got)
	}

	if _, err := downloadsRepo.db.ExecContext(ctx, `UPDATE library SET resolution = ? WHERE id = ?`, "1920x1080", id); err != nil {
		t.Fatal(err)
	}
	newTitle, newUploader, duration := "Refreshed Title", "Refreshed Uploader", 999
	if err := repo.UpdateMetadata(ctx, id, &newTitle, &newUploader, &duration, nil, nil); err != nil {
		t.Fatalf("UpdateMetadata: %v", err)
	}
	got, err = repo.Get(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "Refreshed Title" || got.Uploader == nil || *got.Uploader != "Refreshed Uploader" || got.Duration == nil || *got.Duration != 999 {
		t.Fatalf("UpdateMetadata did not persist: %+v", got)
	}
	if got.Resolution == nil || *got.Resolution != "1920x1080" {
		t.Fatalf("expected nil resolution to preserve existing value via COALESCE, got %+v", got.Resolution)
	}

	if err := repo.UpdateTitle(ctx, 99999, "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound updating unknown id, got %v", err)
	}

	if err := repo.Delete(ctx, id); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := repo.Get(ctx, id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
	if err := repo.Delete(ctx, 99999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound deleting unknown id, got %v", err)
	}
}

package thumbnailenhance

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// Deleting the last history row of an item frees its original-thumbnail backup.
// "Count the rows, then delete the backup" is a check-then-write: an enhancement
// of the same item that is still running (it holds enhanceMu until its history
// row is written) must be waited for, or its backup would be deleted from under
// it and the new history row would point at nothing to revert to.
func TestDeletingLastHistoryRowWaitsForARunningEnhancement(t *testing.T) {
	conn := openTestDB(t)
	ctx := context.Background()
	library := repository.NewLibraryRepo(conn)
	history := repository.NewThumbnailEnhancementHistoryRepo(conn)
	originals := repository.NewThumbnailEnhancementOriginalsRepo(conn)
	deps := Deps{LibraryRepo: library, HistoryRepo: history, OriginalsRepo: originals, ImagesRoot: t.TempDir()}

	item, err := library.Create(ctx, &models.LibraryItem{Title: "a", Filename: "a.mp4", Path: "a.mp4", Status: "completed"})
	if err != nil {
		t.Fatal(err)
	}
	if err := originals.Create(ctx, item, filepath.ToSlash(filepath.Join("library", "1", "original", "x.jpg"))); err != nil {
		t.Fatal(err)
	}
	entry := func() *models.ThumbnailEnhancementHistoryEntry {
		return &models.ThumbnailEnhancementHistoryEntry{LibraryItemID: &item, ItemTitle: "a", Status: "success", TriggerType: "manual", Mode: "upscale"}
	}
	first, err := history.Create(ctx, entry())
	if err != nil {
		t.Fatal(err)
	}

	// A new enhancement of the item is in flight: it holds enhanceMu and has not
	// written its history row yet.
	enhanceMu.Lock()
	done := make(chan error, 1)
	go func() { done <- DeleteHistoryEntry(ctx, deps, first) }()

	select {
	case err := <-done:
		enhanceMu.Unlock()
		t.Fatalf("DeleteHistoryEntry returned (%v) while an enhancement of the same item was running", err)
	case <-time.After(300 * time.Millisecond):
	}
	if _, err := history.Create(ctx, entry()); err != nil { // the enhancement finishes and records itself
		enhanceMu.Unlock()
		t.Fatal(err)
	}
	enhanceMu.Unlock()

	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("DeleteHistoryEntry never finished")
	}
	if _, err := originals.Get(ctx, item); err != nil {
		t.Errorf("the backup was deleted although a history row still references the item: %v", err)
	}
}

// Without a running enhancement the cascade still happens.
func TestDeletingTheOnlyHistoryRowFreesTheBackup(t *testing.T) {
	conn := openTestDB(t)
	ctx := context.Background()
	library := repository.NewLibraryRepo(conn)
	history := repository.NewThumbnailEnhancementHistoryRepo(conn)
	originals := repository.NewThumbnailEnhancementOriginalsRepo(conn)
	deps := Deps{LibraryRepo: library, HistoryRepo: history, OriginalsRepo: originals, ImagesRoot: t.TempDir()}

	item, err := library.Create(ctx, &models.LibraryItem{Title: "a", Filename: "a.mp4", Path: "a.mp4", Status: "completed"})
	if err != nil {
		t.Fatal(err)
	}
	if err := originals.Create(ctx, item, "library/1/original/x.jpg"); err != nil {
		t.Fatal(err)
	}
	id, err := history.Create(ctx, &models.ThumbnailEnhancementHistoryEntry{LibraryItemID: &item, ItemTitle: "a", Status: "success", TriggerType: "manual", Mode: "upscale"})
	if err != nil {
		t.Fatal(err)
	}
	if err := DeleteHistoryEntry(ctx, deps, id); err != nil {
		t.Fatal(err)
	}
	if _, err := originals.Get(ctx, item); err == nil {
		t.Error("the backup survived the deletion of the item's last history row")
	}
}

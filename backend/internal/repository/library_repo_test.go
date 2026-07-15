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

	originalURL := "https://example.com/x"
	id, err := repo.Create(ctx, &models.LibraryItem{
		Title: "Original Title", Filename: "video.mp4", Path: "video.mp4",
		OriginalURL: &originalURL, Status: "completed",
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
	if err := repo.UpdateMetadata(ctx, id, &newTitle, &newUploader, &duration, nil, nil, nil, nil, nil, nil); err != nil {
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

func TestLibraryRepo_Query(t *testing.T) {
	ctx := context.Background()
	downloadsRepo := openTestDB(t)
	repo := NewLibraryRepo(downloadsRepo.db)
	collectionsRepo := NewCollectionsRepo(downloadsRepo.db)
	tagsRepo := NewTagsRepo(downloadsRepo.db)

	collectionID, err := collectionsRepo.Create(ctx, &models.Collection{
		Name: "Music", RootPath: "Music", DefaultQuality: "best", DefaultDownloadType: "audio",
	})
	if err != nil {
		t.Fatalf("creating test collection: %v", err)
	}

	year2020, year2021 := 2020, 2021
	alphaID, err := repo.Create(ctx, &models.LibraryItem{
		Title: "Alpha Zebra Song", Filename: "alpha.mp3", Path: "alpha.mp3",
		CollectionID: &collectionID, Status: "completed", ReleaseYear: &year2020,
	})
	if err != nil {
		t.Fatalf("creating alpha item: %v", err)
	}
	betaID, err := repo.Create(ctx, &models.LibraryItem{
		Title: "Beta Yak Song", Filename: "beta.mp3", Path: "beta.mp3",
		Status: "completed", ReleaseYear: &year2021,
	})
	if err != nil {
		t.Fatalf("creating beta item: %v", err)
	}
	gammaID, err := repo.Create(ctx, &models.LibraryItem{
		Title: "Gamma Xerus Song", Filename: "gamma.mp3", Path: "gamma.mp3",
		Status: "completed",
	})
	if err != nil {
		t.Fatalf("creating gamma item: %v", err)
	}

	tagID, err := tagsRepo.Create(ctx, "favorite")
	if err != nil {
		t.Fatalf("creating tag: %v", err)
	}
	if err := tagsRepo.SetForLibraryItem(ctx, alphaID, []int64{tagID.ID}); err != nil {
		t.Fatalf("tagging alpha: %v", err)
	}

	t.Run("search matches title substring via FTS", func(t *testing.T) {
		items, total, err := repo.Query(ctx, LibraryQuery{Search: "Zebra"})
		if err != nil {
			t.Fatalf("Query: %v", err)
		}
		if total != 1 || len(items) != 1 || items[0].ID != alphaID {
			t.Fatalf("expected exactly alpha item to match 'Zebra', got total=%d items=%+v", total, items)
		}
	})

	t.Run("search finds nothing for unrelated text", func(t *testing.T) {
		_, total, err := repo.Query(ctx, LibraryQuery{Search: "NoSuchWordAnywhere"})
		if err != nil {
			t.Fatalf("Query: %v", err)
		}
		if total != 0 {
			t.Fatalf("expected 0 matches, got %d", total)
		}
	})

	t.Run("collection filter scopes to one folder's contents", func(t *testing.T) {
		items, total, err := repo.Query(ctx, LibraryQuery{CollectionID: &collectionID})
		if err != nil {
			t.Fatalf("Query: %v", err)
		}
		if total != 1 || len(items) != 1 || items[0].ID != alphaID {
			t.Fatalf("expected only alpha item in the Music collection, got total=%d items=%+v", total, items)
		}
	})

	t.Run("collection IS NULL filter scopes to uncategorized items (folder view root)", func(t *testing.T) {
		items, total, err := repo.Query(ctx, LibraryQuery{CollectionIDIsNull: true})
		if err != nil {
			t.Fatalf("Query: %v", err)
		}
		if total != 2 {
			t.Fatalf("expected beta+gamma (uncategorized) to match, got total=%d items=%+v", total, items)
		}
		for _, item := range items {
			if item.ID == alphaID {
				t.Fatalf("alpha (in Music collection) should not match CollectionIDIsNull, got %+v", items)
			}
		}
	})

	t.Run("year filter", func(t *testing.T) {
		_, total, err := repo.Query(ctx, LibraryQuery{Year: &year2021})
		if err != nil {
			t.Fatalf("Query: %v", err)
		}
		if total != 1 {
			t.Fatalf("expected 1 match for year 2021, got %d", total)
		}
	})

	t.Run("tag filter AND semantics", func(t *testing.T) {
		items, total, err := repo.Query(ctx, LibraryQuery{Tags: []string{"favorite"}})
		if err != nil {
			t.Fatalf("Query: %v", err)
		}
		if total != 1 || len(items) != 1 || items[0].ID != alphaID {
			t.Fatalf("expected only the tagged alpha item, got total=%d items=%+v", total, items)
		}
	})

	t.Run("sort by title ascending", func(t *testing.T) {
		items, _, err := repo.Query(ctx, LibraryQuery{SortKey: "title", SortDir: "asc"})
		if err != nil {
			t.Fatalf("Query: %v", err)
		}
		if len(items) != 3 || items[0].ID != alphaID || items[1].ID != betaID || items[2].ID != gammaID {
			t.Fatalf("expected alpha,beta,gamma order, got %+v", items)
		}
	})

	t.Run("pagination returns the right slice and total", func(t *testing.T) {
		items, total, err := repo.Query(ctx, LibraryQuery{SortKey: "title", SortDir: "asc", Page: 1, PageSize: 2})
		if err != nil {
			t.Fatalf("Query: %v", err)
		}
		if total != 3 {
			t.Fatalf("expected total=3 regardless of page size, got %d", total)
		}
		if len(items) != 2 || items[0].ID != alphaID || items[1].ID != betaID {
			t.Fatalf("expected first page [alpha,beta], got %+v", items)
		}

		items, total, err = repo.Query(ctx, LibraryQuery{SortKey: "title", SortDir: "asc", Page: 2, PageSize: 2})
		if err != nil {
			t.Fatalf("Query: %v", err)
		}
		if total != 3 {
			t.Fatalf("expected total=3 on page 2 as well, got %d", total)
		}
		if len(items) != 1 || items[0].ID != gammaID {
			t.Fatalf("expected second page [gamma], got %+v", items)
		}
	})

	t.Run("Page zero returns everything unpaginated", func(t *testing.T) {
		items, total, err := repo.Query(ctx, LibraryQuery{})
		if err != nil {
			t.Fatalf("Query: %v", err)
		}
		if total != 3 || len(items) != 3 {
			t.Fatalf("expected all 3 items with Page=0, got total=%d len=%d", total, len(items))
		}
	})
}

func TestLibraryRepo_FindDuplicate(t *testing.T) {
	ctx := context.Background()
	downloadsRepo := openTestDB(t)
	repo := NewLibraryRepo(downloadsRepo.db)

	url := "https://example.com/watch?v=abc123"
	videoID := "abc123"
	itemID, err := repo.Create(ctx, &models.LibraryItem{
		Title: "Existing Item", Filename: "existing.mp4", Path: "existing.mp4",
		Status: "completed", OriginalURL: &url, VideoID: &videoID,
	})
	if err != nil {
		t.Fatalf("creating fixture item: %v", err)
	}

	t.Run("match by URL only", func(t *testing.T) {
		got, err := repo.FindDuplicate(ctx, url, "")
		if err != nil {
			t.Fatalf("FindDuplicate: %v", err)
		}
		if got == nil || got.ID != itemID {
			t.Fatalf("expected match on itemID=%d, got %+v", itemID, got)
		}
	})

	t.Run("match by video_id only", func(t *testing.T) {
		got, err := repo.FindDuplicate(ctx, "", videoID)
		if err != nil {
			t.Fatalf("FindDuplicate: %v", err)
		}
		if got == nil || got.ID != itemID {
			t.Fatalf("expected match on itemID=%d, got %+v", itemID, got)
		}
	})

	t.Run("match when both URL and video_id supplied", func(t *testing.T) {
		got, err := repo.FindDuplicate(ctx, url, videoID)
		if err != nil {
			t.Fatalf("FindDuplicate: %v", err)
		}
		if got == nil || got.ID != itemID {
			t.Fatalf("expected match on itemID=%d, got %+v", itemID, got)
		}
	})

	t.Run("no match returns nil, nil", func(t *testing.T) {
		got, err := repo.FindDuplicate(ctx, "https://example.com/watch?v=unrelated", "unrelated")
		if err != nil {
			t.Fatalf("FindDuplicate: %v", err)
		}
		if got != nil {
			t.Fatalf("expected nil for no match, got %+v", got)
		}
	})

	t.Run("both empty returns nil, nil without querying", func(t *testing.T) {
		got, err := repo.FindDuplicate(ctx, "", "")
		if err != nil {
			t.Fatalf("FindDuplicate: %v", err)
		}
		if got != nil {
			t.Fatalf("expected nil when both inputs empty, got %+v", got)
		}
	})
}

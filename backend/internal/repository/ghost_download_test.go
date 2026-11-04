package repository

import (
	"context"
	"errors"
	"testing"

	"packrat/backend/internal/models"
)

func newGhost(t *testing.T, lib *LibraryRepo, title string) int64 {
	t.Helper()
	id, err := lib.Create(context.Background(), &models.LibraryItem{Title: title, Status: "ghost"})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestLibraryRepo_CompleteGhostFromDownload(t *testing.T) {
	ctx := context.Background()
	dl := openTestDB(t)
	lib := NewLibraryRepo(dl.db)

	year := 1999
	ghost, err := lib.Create(ctx, &models.LibraryItem{Title: "old", Status: "ghost", ReleaseYear: &year})
	if err != nil {
		t.Fatal(err)
	}
	dlID, err := dl.Create(ctx, &models.Download{URL: "https://e.test/1", DownloadType: "video", Quality: "best", Status: models.StatusDownloading})
	if err != nil {
		t.Fatal(err)
	}

	mt, res, thumb, size, dur := "video", "1280x720", "a/b.jpg", int64(42), 12
	err = lib.CompleteGhostFromDownload(ctx, ghost, &models.LibraryItem{
		DownloadID: &dlID, Title: "new", Filename: "b.mp4", Path: "a/b.mp4", Folder: "a",
		MediaType: &mt, Resolution: &res, Thumbnail: &thumb, FileSizeBytes: &size, Duration: &dur,
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	got, err := lib.Get(ctx, ghost)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "completed" || got.Title != "new" || got.Filename != "b.mp4" || got.Path != "a/b.mp4" ||
		got.Folder != "a" || got.Resolution == nil || *got.Resolution != res || got.Thumbnail == nil ||
		got.FileSizeBytes == nil || *got.FileSizeBytes != 42 || got.DownloadID == nil || *got.DownloadID != dlID {
		t.Fatalf("ghost not filled in: %+v", got)
	}
	if got.ReleaseYear == nil || *got.ReleaseYear != 1999 {
		t.Fatalf("a nil year from the download must not blank the ghost's: %v", got.ReleaseYear)
	}

	// Already filled: no longer a ghost, so a second fill is refused.
	if err := lib.CompleteGhostFromDownload(ctx, ghost, &models.LibraryItem{Title: "x"}, false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second fill err = %v, want ErrNotFound", err)
	}
	// Deleted row: ErrNotFound too (the caller falls back to Create).
	if err := lib.CompleteGhostFromDownload(ctx, 9999, &models.LibraryItem{Title: "x"}, false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing row err = %v, want ErrNotFound", err)
	}
}

func TestLibraryRepo_CompleteGhostKeepMetadata(t *testing.T) {
	ctx := context.Background()
	dl := openTestDB(t)
	lib := NewLibraryRepo(dl.db)
	up, desc := "my uploader", "my description"
	ghost, err := lib.Create(ctx, &models.LibraryItem{Title: "my edited title", Uploader: &up, Description: &desc, Status: "ghost"})
	if err != nil {
		t.Fatal(err)
	}
	nu, nd, res := "dl uploader", "dl description", "1280x720"
	err = lib.CompleteGhostFromDownload(ctx, ghost, &models.LibraryItem{
		Title: "download title", Uploader: &nu, Description: &nd, Filename: "f.mp4", Path: "f.mp4", Resolution: &res,
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := lib.Get(ctx, ghost)
	if got.Title != "my edited title" || got.Uploader == nil || *got.Uploader != up || got.Description == nil || *got.Description != desc {
		t.Fatalf("keepMetadata must preserve title/uploader/description: %+v", got)
	}
	if got.Status != "completed" || got.Filename != "f.mp4" || got.Path != "f.mp4" || got.Resolution == nil {
		t.Fatalf("file fields must still be filled: %+v", got)
	}

	// keepMetadata=false takes the download's values.
	g2, _ := lib.Create(ctx, &models.LibraryItem{Title: "old", Uploader: &up, Description: &desc, Status: "ghost"})
	if err := lib.CompleteGhostFromDownload(ctx, g2, &models.LibraryItem{Title: "download title", Uploader: &nu, Description: &nd, Filename: "g.mp4", Path: "g.mp4"}, false); err != nil {
		t.Fatal(err)
	}
	got, _ = lib.Get(ctx, g2)
	if got.Title != "download title" || *got.Uploader != nu || *got.Description != nd {
		t.Fatalf("keepMetadata=false should take the download's values: %+v", got)
	}
}

func TestDownloadsRepo_ActiveDownloadIDsByLibraryItem(t *testing.T) {
	ctx := context.Background()
	dl := openTestDB(t)
	lib := NewLibraryRepo(dl.db)
	a, b, c, d := newGhost(t, lib, "a"), newGhost(t, lib, "b"), newGhost(t, lib, "c"), newGhost(t, lib, "d")

	mk := func(status models.DownloadStatus, ghost, target *int64) int64 {
		id, err := dl.Create(ctx, &models.Download{URL: "https://e.test/x", DownloadType: "video", Quality: "best", Status: status, GhostLibraryItemID: ghost, TargetLibraryItemID: target})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	mk(models.StatusFailed, &a, nil) // finished: not active
	runningA := mk(models.StatusDownloading, &a, nil)
	queuedB := mk(models.StatusQueued, &b, nil)
	redownC := mk(models.StatusFetchingMetadata, nil, &c)
	mk(models.StatusCancelled, &d, nil)

	got, err := dl.ActiveDownloadIDsByLibraryItem(ctx, []int64{a, b, c, d, 12345})
	if err != nil {
		t.Fatal(err)
	}
	want := map[int64]int64{a: runningA, b: queuedB, c: redownC}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("item %d: got download %d, want %d (all: %v)", k, got[k], v, got)
		}
	}
	if m, err := dl.ActiveDownloadIDsByLibraryItem(ctx, nil); err != nil || len(m) != 0 {
		t.Fatalf("empty input: %v %v", m, err)
	}
}

// The ghost link is a real FK: deleting the library row must null it, not
// delete or block anything (migration 000052).
func TestDownloads_GhostLibraryItemFKSetsNullOnDelete(t *testing.T) {
	ctx := context.Background()
	dl := openTestDB(t)
	lib := NewLibraryRepo(dl.db)
	ghost := newGhost(t, lib, "g")
	id, err := dl.Create(ctx, &models.Download{URL: "https://e.test/y", DownloadType: "video", Quality: "best", Status: models.StatusFailed, GhostLibraryItemID: &ghost})
	if err != nil {
		t.Fatal(err)
	}
	if d, _ := dl.Get(ctx, id); d.GhostLibraryItemID == nil || *d.GhostLibraryItemID != ghost {
		t.Fatalf("ghost link not stored: %+v", d.GhostLibraryItemID)
	}
	if err := lib.Delete(ctx, ghost); err != nil {
		t.Fatal(err)
	}
	d, err := dl.Get(ctx, id)
	if err != nil {
		t.Fatalf("download row must survive: %v", err)
	}
	if d.GhostLibraryItemID != nil {
		t.Fatalf("ghost link should be NULL after delete, got %d", *d.GhostLibraryItemID)
	}
	// And a dangling id is rejected outright.
	bad := int64(424242)
	if _, err := dl.Create(ctx, &models.Download{URL: "https://e.test/z", DownloadType: "video", Quality: "best", Status: models.StatusQueued, GhostLibraryItemID: &bad}); err == nil {
		t.Fatal("expected FK violation for a non-existent library item")
	}
}

package repository

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
)

func openTestDB(t *testing.T) *DownloadsRepo {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "packrat_test.db")
	conn, err := db.Open(dbPath)
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
	return NewDownloadsRepo(conn)
}

func TestDownloadsRepo_CreateGetList(t *testing.T) {
	ctx := context.Background()
	repo := openTestDB(t)

	d := &models.Download{
		URL:          "https://example.com/watch?v=abc123",
		Folder:       "",
		Filename:     "",
		DownloadType: "video",
		Quality:      "1080p",
		Status:       models.StatusQueued,
	}
	id, err := repo.Create(ctx, d)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if id == 0 {
		t.Fatalf("expected nonzero id")
	}

	got, err := repo.Get(ctx, id)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.URL != d.URL || got.Status != models.StatusQueued || got.Quality != "1080p" {
		t.Fatalf("unexpected row: %+v", got)
	}

	title := "Test Video"
	uploader := "Test Channel"
	duration := 120
	videoID := "abc123"
	if err := repo.UpdateMetadata(ctx, id, &videoID, &title, &uploader, &duration, nil); err != nil {
		t.Fatalf("UpdateMetadata: %v", err)
	}

	if err := repo.UpdateStatus(ctx, id, models.StatusDownloading, nil); err != nil {
		t.Fatalf("UpdateStatus: %v", err)
	}

	resolution := "1920x1080"
	if err := repo.MarkCompleted(ctx, id, 0, &resolution, "stdout output", "stderr output"); err != nil {
		t.Fatalf("MarkCompleted: %v", err)
	}

	got, err = repo.Get(ctx, id)
	if err != nil {
		t.Fatalf("Get after complete: %v", err)
	}
	if got.Status != models.StatusCompleted {
		t.Fatalf("expected status completed, got %s", got.Status)
	}
	if got.Title == nil || *got.Title != title {
		t.Fatalf("expected title %q, got %+v", title, got.Title)
	}
	if got.CompletedAt == nil {
		t.Fatalf("expected CompletedAt to be set")
	}
	if got.StdoutTail == nil || *got.StdoutTail != "stdout output" {
		t.Fatalf("expected stdout tail %q, got %+v", "stdout output", got.StdoutTail)
	}
	if got.StderrTail == nil || *got.StderrTail != "stderr output" {
		t.Fatalf("expected stderr tail %q, got %+v", "stderr output", got.StderrTail)
	}

	list, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 row, got %d", len(list))
	}
}

func TestDownloadsRepo_DeleteNullsLibraryBackref(t *testing.T) {
	ctx := context.Background()
	repo := openTestDB(t)
	libraryRepo := NewLibraryRepo(repo.db)

	id, err := repo.Create(ctx, &models.Download{
		URL: "https://example.com/x", DownloadType: "video", Quality: "best", Status: models.StatusCompleted,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	libID, err := libraryRepo.Create(ctx, &models.LibraryItem{
		DownloadID: &id, Title: "X", Filename: "x.mp4", Path: "x.mp4", Status: "completed",
	})
	if err != nil {
		t.Fatalf("Create library item: %v", err)
	}

	if err := repo.Delete(ctx, id); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := repo.Get(ctx, id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}

	libItem, err := libraryRepo.Get(ctx, libID)
	if err != nil {
		t.Fatalf("library item should survive download deletion: %v", err)
	}
	if libItem.DownloadID != nil {
		t.Fatalf("expected download_id nulled out via ON DELETE SET NULL, got %+v", libItem.DownloadID)
	}

	if err := repo.Delete(ctx, 99999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound deleting unknown id, got %v", err)
	}
}

func TestHistoryRepo_CreateAndList(t *testing.T) {
	ctx := context.Background()
	downloadsRepo := openTestDB(t)
	historyRepo := NewHistoryRepo(downloadsRepo.db)

	dID, err := downloadsRepo.Create(ctx, &models.Download{
		URL: "https://example.com/x", DownloadType: "video", Quality: "best", Status: models.StatusCompleted,
	})
	if err != nil {
		t.Fatalf("Create download: %v", err)
	}
	title := "Some Video"
	thumb := "x.jpg"
	if err := downloadsRepo.UpdateMetadata(ctx, dID, nil, &title, nil, nil, &thumb); err != nil {
		t.Fatalf("UpdateMetadata: %v", err)
	}

	completedID, err := historyRepo.Create(ctx, &dID, "https://example.com/x", "completed", nil)
	if err != nil {
		t.Fatalf("Create completed history entry: %v", err)
	}
	errMsg := "yt-dlp exited with code 1"
	if _, err := historyRepo.Create(ctx, nil, "https://example.com/y", "failed", &errMsg); err != nil {
		t.Fatalf("Create failed history entry: %v", err)
	}

	got, err := historyRepo.Get(ctx, completedID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Title == nil || *got.Title != title || got.Thumbnail == nil || *got.Thumbnail != thumb {
		t.Fatalf("expected joined title/thumbnail from downloads row, got %+v", got)
	}

	list, err := historyRepo.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 history entries, got %d", len(list))
	}

	// Deleting the originating download must not delete the history entry —
	// download_id is ON DELETE SET NULL, and title/thumbnail simply stop
	// being joinable afterward.
	if err := downloadsRepo.Delete(ctx, dID); err != nil {
		t.Fatalf("deleting download: %v", err)
	}
	survived, err := historyRepo.Get(ctx, completedID)
	if err != nil {
		t.Fatalf("history entry should survive download deletion: %v", err)
	}
	if survived.DownloadID != nil {
		t.Fatalf("expected download_id nulled out via ON DELETE SET NULL, got %+v", survived.DownloadID)
	}
	if survived.Title != nil {
		t.Fatalf("expected title to no longer be joinable after download deletion, got %+v", survived.Title)
	}

	if _, err := historyRepo.Get(ctx, 99999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for unknown id, got %v", err)
	}
}

func TestDownloadsRepo_MarkInterruptedIfActive(t *testing.T) {
	ctx := context.Background()
	repo := openTestDB(t)

	activeID, err := repo.Create(ctx, &models.Download{URL: "https://example.com/a", DownloadType: "video", Quality: "best", Status: models.StatusDownloading})
	if err != nil {
		t.Fatalf("Create active: %v", err)
	}
	doneID, err := repo.Create(ctx, &models.Download{URL: "https://example.com/b", DownloadType: "video", Quality: "best", Status: models.StatusCompleted})
	if err != nil {
		t.Fatalf("Create completed: %v", err)
	}

	affected, err := repo.MarkInterruptedIfActive(ctx)
	if err != nil {
		t.Fatalf("MarkInterruptedIfActive: %v", err)
	}
	if len(affected) != 1 || affected[0].ID != activeID {
		t.Fatalf("expected exactly the active row returned, got %+v", affected)
	}

	active, err := repo.Get(ctx, activeID)
	if err != nil {
		t.Fatalf("Get active: %v", err)
	}
	if active.Status != models.StatusInterrupted {
		t.Fatalf("expected interrupted, got %s", active.Status)
	}

	done, err := repo.Get(ctx, doneID)
	if err != nil {
		t.Fatalf("Get completed: %v", err)
	}
	if done.Status != models.StatusCompleted {
		t.Fatalf("expected completed status untouched, got %s", done.Status)
	}
}

package repository

import (
	"context"
	"testing"
	"time"
)

func TestHistoryRepo_DeleteOlderThan(t *testing.T) {
	ctx := context.Background()
	downloadsRepo := openTestDB(t)
	repo := NewHistoryRepo(downloadsRepo.db)

	oldID, err := repo.Create(ctx, nil, "https://example.com/old", "completed", nil)
	if err != nil {
		t.Fatalf("creating old fixture: %v", err)
	}
	recentID, err := repo.Create(ctx, nil, "https://example.com/recent", "completed", nil)
	if err != nil {
		t.Fatalf("creating recent fixture: %v", err)
	}

	// Create() always stamps created_at via SQLite's datetime('now'), so
	// backdate the "old" row directly — same technique library_repo_test.go
	// uses to set up a value the repo API itself can't control.
	oldTimestamp := time.Now().AddDate(0, 0, -100).UTC().Format("2006-01-02 15:04:05")
	if _, err := downloadsRepo.db.ExecContext(ctx, `UPDATE history SET created_at = ? WHERE id = ?`, oldTimestamp, oldID); err != nil {
		t.Fatalf("backdating old fixture: %v", err)
	}

	cutoff := time.Now().AddDate(0, 0, -30)
	n, err := repo.DeleteOlderThan(ctx, cutoff)
	if err != nil {
		t.Fatalf("DeleteOlderThan: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1 row deleted, got %d", n)
	}

	rows, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(rows) != 1 || rows[0].ID != recentID {
		t.Fatalf("expected only the recent entry (id=%d) to remain, got %+v", recentID, rows)
	}

	// A second call with nothing left to delete should be a clean no-op.
	n, err = repo.DeleteOlderThan(ctx, cutoff)
	if err != nil {
		t.Fatalf("DeleteOlderThan (second call): %v", err)
	}
	if n != 0 {
		t.Fatalf("expected 0 rows deleted on second call, got %d", n)
	}
}

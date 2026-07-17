package repository

import (
	"context"
	"testing"
	"time"

	"packrat/backend/internal/models"
)

func TestDownloadsRepo_DeleteOlderThan(t *testing.T) {
	ctx := context.Background()
	repo := openTestDB(t)

	oldID, err := repo.Create(ctx, &models.Download{URL: "https://example.com/old", DownloadType: "video", Quality: "best", Status: models.StatusCompleted})
	if err != nil {
		t.Fatalf("creating old fixture: %v", err)
	}
	recentID, err := repo.Create(ctx, &models.Download{URL: "https://example.com/recent", DownloadType: "video", Quality: "best", Status: models.StatusCompleted})
	if err != nil {
		t.Fatalf("creating recent fixture: %v", err)
	}
	// An old but still-active row (e.g. stuck mid-download) must survive the
	// sweep regardless of age — this is a log-pruning operation, never a
	// queue-cancellation one.
	activeID, err := repo.Create(ctx, &models.Download{URL: "https://example.com/active", DownloadType: "video", Quality: "best", Status: models.StatusDownloading})
	if err != nil {
		t.Fatalf("creating active fixture: %v", err)
	}

	oldTimestamp := time.Now().AddDate(0, 0, -100).UTC().Format("2006-01-02 15:04:05")
	if _, err := repo.db.ExecContext(ctx, `UPDATE downloads SET created_at = ? WHERE id IN (?, ?)`, oldTimestamp, oldID, activeID); err != nil {
		t.Fatalf("backdating old fixtures: %v", err)
	}

	cutoff := time.Now().AddDate(0, 0, -30)
	n, err := repo.DeleteOlderThan(ctx, cutoff)
	if err != nil {
		t.Fatalf("DeleteOlderThan: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1 row deleted (the old completed one), got %d", n)
	}

	rows, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected the recent and active entries to remain, got %+v", rows)
	}
	remaining := map[int64]bool{}
	for _, r := range rows {
		remaining[r.ID] = true
	}
	if !remaining[recentID] || !remaining[activeID] {
		t.Fatalf("expected recent (id=%d) and active (id=%d) entries to remain, got %+v", recentID, activeID, rows)
	}

	// A second call with nothing eligible left should be a clean no-op.
	n, err = repo.DeleteOlderThan(ctx, cutoff)
	if err != nil {
		t.Fatalf("DeleteOlderThan (second call): %v", err)
	}
	if n != 0 {
		t.Fatalf("expected 0 rows deleted on second call, got %d", n)
	}
}

func TestDownloadsRepo_GenerateNFO(t *testing.T) {
	ctx := context.Background()
	repo := openTestDB(t)

	onID, err := repo.Create(ctx, &models.Download{URL: "https://example.com/on", DownloadType: "video", Quality: "best", Status: models.StatusCompleted, GenerateNFO: true})
	if err != nil {
		t.Fatalf("creating GenerateNFO=true fixture: %v", err)
	}
	offID, err := repo.Create(ctx, &models.Download{URL: "https://example.com/off", DownloadType: "video", Quality: "best", Status: models.StatusCompleted})
	if err != nil {
		t.Fatalf("creating GenerateNFO=false fixture: %v", err)
	}

	on, err := repo.Get(ctx, onID)
	if err != nil {
		t.Fatalf("Get(on): %v", err)
	}
	if !on.GenerateNFO {
		t.Fatalf("expected GenerateNFO to round-trip as true, got %+v", on)
	}

	off, err := repo.Get(ctx, offID)
	if err != nil {
		t.Fatalf("Get(off): %v", err)
	}
	if off.GenerateNFO {
		t.Fatalf("expected GenerateNFO to default to false when unset, got %+v", off)
	}
}

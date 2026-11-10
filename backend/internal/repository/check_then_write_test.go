package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
)

// These tests cover the read-then-write paths that no transaction, repo mutex or
// UNIQUE constraint used to protect. They run many goroutines at the same
// operation on the connection pool and assert the invariant the check was
// meant to give.

func openPoolTestDB(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	dir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(conn, dir); err != nil {
		t.Fatal(err)
	}
	return conn
}

// race runs fn on n goroutines released together and waits for all of them.
func race(n int, fn func(i int)) {
	var ready, done sync.WaitGroup
	start := make(chan struct{})
	ready.Add(n)
	done.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer done.Done()
			ready.Done()
			<-start
			fn(i)
		}()
	}
	ready.Wait()
	close(start)
	done.Wait()
}

func newLibraryItem(t *testing.T, repo *LibraryRepo, name string) int64 {
	t.Helper()
	id, err := repo.Create(context.Background(), &models.LibraryItem{
		Title: name, Filename: name + ".mp4", Path: name + ".mp4", Status: "completed",
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestFrameMatchQueueCreateIfAbsentIsAtomic(t *testing.T) {
	conn := openPoolTestDB(t)
	library := NewLibraryRepo(conn)
	queue := NewFrameMatchQueueRepo(conn)
	ctx := context.Background()
	item := newLibraryItem(t, library, "a")

	var created atomic.Int32
	race(16, func(int) {
		_, ok, err := queue.CreateIfAbsent(ctx, item, "a", "url")
		if err != nil {
			t.Error(err)
		}
		if ok {
			created.Add(1)
		}
	})
	if created.Load() != 1 {
		t.Errorf("created = %d, want exactly 1", created.Load())
	}
	rows, err := queue.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Errorf("queue has %d rows for one item, want 1", len(rows))
	}
}

func TestPruneBackupHistoryConcurrentlyReturnsEachRowOnce(t *testing.T) {
	conn := openPoolTestDB(t)
	repo := NewBackupHistoryRepo(conn)
	ctx := context.Background()
	for i := 0; i < 40; i++ {
		if _, err := repo.Create(ctx, models.BackupHistory{TriggerType: "manual", Status: "failed"}); err != nil {
			t.Fatal(err)
		}
	}
	const keep = 5
	var mu sync.Mutex
	seen := map[int64]int{}
	race(8, func(int) {
		rows, err := repo.DeleteFailedExceedingRetention(ctx, keep)
		if err != nil {
			t.Error(err)
			return
		}
		mu.Lock()
		for _, r := range rows {
			seen[r.ID]++
		}
		mu.Unlock()
	})
	if len(seen) != 40-keep {
		t.Errorf("pruned %d distinct rows, want %d", len(seen), 40-keep)
	}
	for id, n := range seen {
		if n != 1 {
			t.Errorf("row %d was returned by %d prunes (its file would be deleted %d times)", id, n, n)
		}
	}
}

// A download that completes while startup recovery runs must not be overwritten
// with "interrupted": the select and the update are one transaction, so the
// completion waits for the commit and then wins.
func TestMarkInterruptedDoesNotOverwriteAConcurrentCompletion(t *testing.T) {
	conn := openPoolTestDB(t)
	repo := NewDownloadsRepo(conn)
	ctx := context.Background()
	const n = 1500
	ids := make([]int64, n)
	for i := range ids {
		id, err := repo.Create(ctx, &models.Download{URL: fmt.Sprintf("https://e.test/%d", i), DownloadType: "video", Quality: "best", Status: models.StatusDownloading})
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = id
	}

	var completed sync.Map
	done := make(chan struct{})
	go func() {
		defer close(done)
		for _, id := range ids {
			if err := repo.MarkCompleted(ctx, id, 0, nil, "", ""); err == nil {
				completed.Store(id, true)
			}
		}
	}()
	if _, err := repo.MarkInterruptedIfActive(ctx); err != nil {
		t.Fatal(err)
	}
	<-done

	lost := 0
	completed.Range(func(k, _ any) bool {
		d, err := repo.Get(ctx, k.(int64))
		if err != nil {
			t.Fatal(err)
		}
		if d.Status != models.StatusCompleted {
			lost++
		}
		return true
	})
	if lost > 0 {
		t.Errorf("%d completed downloads were overwritten with %q", lost, models.StatusInterrupted)
	}
}

func TestThumbnailEnhancementHistoryDeleteSucceedsOnce(t *testing.T) {
	conn := openPoolTestDB(t)
	library := NewLibraryRepo(conn)
	repo := NewThumbnailEnhancementHistoryRepo(conn)
	ctx := context.Background()
	item := newLibraryItem(t, library, "a")

	for round := 0; round < 150; round++ {
		id, err := repo.Create(ctx, &models.ThumbnailEnhancementHistoryEntry{LibraryItemID: &item, ItemTitle: "a", Status: "success", TriggerType: "manual", Mode: "upscale"})
		if err != nil {
			t.Fatal(err)
		}
		var ok, notFound atomic.Int32
		race(6, func(int) {
			got, err := repo.Delete(ctx, id)
			switch {
			case err == nil:
				if got == nil || *got != item {
					t.Errorf("Delete returned item %v, want %d", got, item)
				}
				ok.Add(1)
			case errors.Is(err, ErrNotFound):
				notFound.Add(1)
			default:
				t.Error(err)
			}
		})
		if ok.Load() != 1 || notFound.Load() != 5 {
			t.Fatalf("round %d: %d deletes succeeded, %d not found; want 1 and 5", round, ok.Load(), notFound.Load())
		}
	}
}

func TestThumbnailEnhancementHistoryDeleteOlderThanReportsItsItems(t *testing.T) {
	conn := openPoolTestDB(t)
	library := NewLibraryRepo(conn)
	repo := NewThumbnailEnhancementHistoryRepo(conn)
	ctx := context.Background()
	a, b := newLibraryItem(t, library, "a"), newLibraryItem(t, library, "b")
	for _, item := range []int64{a, a, b} {
		item := item
		if _, err := repo.Create(ctx, &models.ThumbnailEnhancementHistoryEntry{LibraryItemID: &item, ItemTitle: "x", Status: "success", TriggerType: "manual", Mode: "upscale"}); err != nil {
			t.Fatal(err)
		}
	}
	n, items, err := repo.DeleteOlderThan(ctx, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 || len(items) != 2 {
		t.Errorf("deleted %d rows for items %v, want 3 rows for 2 items", n, items)
	}
}

func TestClearFileIfPathLeavesAChangedItemAlone(t *testing.T) {
	conn := openPoolTestDB(t)
	repo := NewLibraryRepo(conn)
	ctx := context.Background()
	id := newLibraryItem(t, repo, "a")

	cleared, err := repo.ClearFileIfPath(ctx, id, "something-else.mp4")
	if err != nil || cleared {
		t.Fatalf("cleared=%v err=%v for a path the item no longer has", cleared, err)
	}
	if item, _ := repo.Get(ctx, id); item.Status != "completed" || item.Path != "a.mp4" {
		t.Fatalf("item changed: %+v", item)
	}
	cleared, err = repo.ClearFileIfPath(ctx, id, "a.mp4")
	if err != nil || !cleared {
		t.Fatalf("cleared=%v err=%v for the current path", cleared, err)
	}
	if item, _ := repo.Get(ctx, id); item.Status != "ghost" || item.Path != "" {
		t.Fatalf("item not cleared: %+v", item)
	}
}

// Selecting an image while it is being deleted must never leave the artist's
// selected image pointing at a row that is gone.
func TestSelectImageNeverLeavesADanglingSelection(t *testing.T) {
	conn := openPoolTestDB(t)
	repo := NewArtistsRepo(conn)
	ctx := context.Background()
	artist, err := repo.Create(ctx, "Someone", nil)
	if err != nil {
		t.Fatal(err)
	}
	for round := 0; round < 60; round++ {
		img, err := repo.AddImage(ctx, artist.ID, fmt.Sprintf("artists/%d/%d.jpg", artist.ID, round))
		if err != nil {
			t.Fatal(err)
		}
		race(2, func(i int) {
			if i == 0 {
				if err := repo.SelectImageForArtist(ctx, artist.ID, img.ID); err != nil && !errors.Is(err, ErrNotFound) {
					t.Error(err)
				}
			} else if _, err := repo.DeleteImageForArtist(ctx, artist.ID, img.ID); err != nil && !errors.Is(err, ErrNotFound) {
				t.Error(err)
			}
		})
		var sel sql.NullString
		if err := conn.QueryRow(`SELECT selected_image_path FROM artists WHERE id = ?`, artist.ID).Scan(&sel); err != nil {
			t.Fatal(err)
		}
		if sel.Valid {
			var n int
			conn.QueryRow(`SELECT COUNT(*) FROM artist_images WHERE artist_id = ? AND relative_path = ?`, artist.ID, sel.String).Scan(&n)
			if n == 0 {
				t.Fatalf("round %d: selected image %q does not exist any more", round, sel.String)
			}
		}
	}
}

func TestLibraryPathExists(t *testing.T) {
	conn := openPoolTestDB(t)
	repo := NewLibraryRepo(conn)
	newLibraryItem(t, repo, "a")
	for path, want := range map[string]bool{"a.mp4": true, "b.mp4": false} {
		got, err := repo.PathExists(context.Background(), path)
		if err != nil || got != want {
			t.Errorf("PathExists(%q) = %v, %v; want %v", path, got, err, want)
		}
	}
}

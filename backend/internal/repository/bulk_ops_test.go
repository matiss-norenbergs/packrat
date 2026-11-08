package repository

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"packrat/backend/internal/models"
)

// 600 > inChunkSize, so the last id falls into the second chunk: a failure
// injected there happens AFTER the first chunk already ran inside the same
// transaction, which is what makes the rollback assertions meaningful.
const bulkTestRows = inChunkSize + 100

func countRows(t *testing.T, d *DownloadsRepo, table string) int {
	t.Helper()
	var n int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func failOn(t *testing.T, d *DownloadsRepo, trigger string) {
	t.Helper()
	if _, err := d.db.Exec(trigger); err != nil {
		t.Fatalf("creating failure trigger: %v", err)
	}
}

func TestDownloadsRepo_DeleteByIDs(t *testing.T) {
	ctx := context.Background()
	repo := openTestDB(t)
	mk := func(status models.DownloadStatus) int64 {
		id, err := repo.Create(ctx, &models.Download{URL: "https://e.test/x", DownloadType: "video", Quality: "best", Status: status})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}

	t.Run("blocked ids change nothing", func(t *testing.T) {
		done, active, queued := mk(models.StatusCompleted), mk(models.StatusDownloading), mk(models.StatusQueued)
		n, blocked, err := repo.DeleteByIDs(ctx, []int64{done, active, queued})
		if err != nil || n != 0 || len(blocked) != 2 || blocked[0] != active || blocked[1] != queued {
			t.Fatalf("got n=%d blocked=%v err=%v", n, blocked, err)
		}
		if _, err := repo.Get(ctx, done); err != nil {
			t.Fatal("the terminal row was deleted although the request was blocked")
		}
	})

	t.Run("more than one chunk", func(t *testing.T) {
		ids := make([]int64, bulkTestRows)
		for i := range ids {
			ids[i] = mk(models.StatusFailed)
		}
		ids = append(ids, 1<<40) // unknown: ignored, not counted
		n, blocked, err := repo.DeleteByIDs(ctx, ids)
		if err != nil || n != bulkTestRows || len(blocked) != 0 {
			t.Fatalf("n=%d blocked=%v err=%v, want %d", n, blocked, err, bulkTestRows)
		}
	})

	t.Run("a failure in a later chunk rolls back the earlier one", func(t *testing.T) {
		ids := make([]int64, bulkTestRows)
		for i := range ids {
			ids[i] = mk(models.StatusFailed)
		}
		before := countRows(t, repo, "downloads")
		failOn(t, repo, fmt.Sprintf(`CREATE TRIGGER fail_dl BEFORE DELETE ON downloads WHEN OLD.id = %d BEGIN SELECT RAISE(ABORT, 'injected'); END`, ids[len(ids)-1]))
		defer repo.db.Exec(`DROP TRIGGER fail_dl`)
		if _, _, err := repo.DeleteByIDs(ctx, ids); err == nil || !strings.Contains(err.Error(), "injected") {
			t.Fatalf("err = %v, want the injected failure", err)
		}
		if after := countRows(t, repo, "downloads"); after != before {
			t.Fatalf("rows %d -> %d: the failed transaction was not rolled back", before, after)
		}
	})
}

func TestHistoryRepo_DeleteByIDs(t *testing.T) {
	ctx := context.Background()
	dl := openTestDB(t)
	repo := NewHistoryRepo(dl.db)
	ids := make([]int64, bulkTestRows)
	for i := range ids {
		id, err := repo.Create(ctx, nil, "https://e.test/h", "failed", nil)
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = id
	}

	failOn(t, dl, fmt.Sprintf(`CREATE TRIGGER fail_h BEFORE DELETE ON history WHEN OLD.id = %d BEGIN SELECT RAISE(ABORT, 'injected'); END`, ids[len(ids)-1]))
	if _, err := repo.DeleteByIDs(ctx, ids); err == nil {
		t.Fatal("expected the injected failure")
	}
	if n := countRows(t, dl, "history"); n != bulkTestRows {
		t.Fatalf("rows = %d, want %d (rolled back)", n, bulkTestRows)
	}
	if _, err := dl.db.Exec(`DROP TRIGGER fail_h`); err != nil {
		t.Fatal(err)
	}
	n, err := repo.DeleteByIDs(ctx, append(ids, 1<<40))
	if err != nil || n != bulkTestRows {
		t.Fatalf("n=%d err=%v, want %d", n, err, bulkTestRows)
	}
}

func TestSubscriptionsRepo_BulkOps(t *testing.T) {
	ctx := context.Background()
	dl := openTestDB(t)
	repo := NewSubscriptionsRepo(dl.db)
	mkSub := func() int64 {
		id, err := repo.Create(ctx, &models.Subscription{URL: "https://e.test/c", Title: "t", MediaType: "video", CheckIntervalHours: 6, Enabled: true})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}

	t.Run("delete rolls back and chunks", func(t *testing.T) {
		ids := make([]int64, bulkTestRows)
		for i := range ids {
			ids[i] = mkSub()
		}
		before := countRows(t, dl, "subscriptions")
		failOn(t, dl, fmt.Sprintf(`CREATE TRIGGER fail_s BEFORE DELETE ON subscriptions WHEN OLD.id = %d BEGIN SELECT RAISE(ABORT, 'injected'); END`, ids[len(ids)-1]))
		if _, err := repo.DeleteByIDs(ctx, ids); err == nil {
			t.Fatal("expected the injected failure")
		}
		if after := countRows(t, dl, "subscriptions"); after != before {
			t.Fatalf("rows %d -> %d, not rolled back", before, after)
		}
		dl.db.Exec(`DROP TRIGGER fail_s`)
		n, err := repo.DeleteByIDs(ctx, ids)
		if err != nil || n != bulkTestRows {
			t.Fatalf("n=%d err=%v", n, err)
		}
	})

	t.Run("seen and unlink are scoped to the subscription, roll back, and chunk", func(t *testing.T) {
		sub, other := mkSub(), mkSub()
		itemID, err := NewLibraryRepo(dl.db).Create(ctx, &models.LibraryItem{Title: "i", Status: "ghost"})
		if err != nil {
			t.Fatal(err)
		}
		sources := make([]string, bulkTestRows)
		for i := range sources {
			sources[i] = fmt.Sprintf("src-%d", i)
			if err := repo.RecordSeenEntry(ctx, sub, sources[i], "t", "https://e.test/"+sources[i], 1, &itemID); err != nil {
				t.Fatal(err)
			}
		}
		if err := repo.RecordSeenEntry(ctx, other, sources[0], "t", "https://e.test/x", 1, &itemID); err != nil {
			t.Fatal(err)
		}

		failOn(t, dl, fmt.Sprintf(`CREATE TRIGGER fail_seen BEFORE UPDATE ON subscription_seen_entries WHEN NEW.source_id = '%s' BEGIN SELECT RAISE(ABORT, 'injected'); END`, sources[len(sources)-1]))
		if _, err := repo.MarkSeenEntries(ctx, sub, sources); err == nil {
			t.Fatal("expected the injected failure")
		}
		if n, _ := repo.CountUnseenEntries(ctx, sub); n != bulkTestRows {
			t.Fatalf("unseen = %d, want %d (rolled back)", n, bulkTestRows)
		}
		if _, err := repo.UnlinkSeenEntries(ctx, sub, sources); err == nil {
			t.Fatal("expected the injected failure on unlink")
		}
		dl.db.Exec(`DROP TRIGGER fail_seen`)

		n, err := repo.MarkSeenEntries(ctx, sub, append(sources, "unknown"))
		if err != nil || n != bulkTestRows {
			t.Fatalf("seen n=%d err=%v", n, err)
		}
		if n, _ := repo.CountUnseenEntries(ctx, other); n != 1 {
			t.Fatalf("another subscription's entry was marked seen")
		}
		n, err = repo.UnlinkSeenEntries(ctx, sub, sources)
		if err != nil || n != bulkTestRows {
			t.Fatalf("unlink n=%d err=%v", n, err)
		}
		if e, _ := repo.GetSeenEntry(ctx, other, sources[0]); e == nil || e.LibraryItemID == nil {
			t.Fatal("another subscription's link was cleared")
		}
	})
}

func TestBackupHistoryRepo_DeleteByIDs(t *testing.T) {
	ctx := context.Background()
	dl := openTestDB(t)
	repo := NewBackupHistoryRepo(dl.db)
	ids := make([]int64, bulkTestRows)
	for i := range ids {
		name := fmt.Sprintf("b%d.zip", i)
		id, err := repo.Create(ctx, models.BackupHistory{TriggerType: "manual", Status: "success", FileName: &name})
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = id
	}
	failOn(t, dl, fmt.Sprintf(`CREATE TRIGGER fail_b BEFORE DELETE ON backup_history WHEN OLD.id = %d BEGIN SELECT RAISE(ABORT, 'injected'); END`, ids[len(ids)-1]))
	if removed, err := repo.DeleteByIDs(ctx, ids); err == nil || removed != nil {
		t.Fatalf("removed=%v err=%v, want the injected failure and no rows reported", removed, err)
	}
	if n := countRows(t, dl, "backup_history"); n != bulkTestRows {
		t.Fatalf("rows = %d, want %d (rolled back)", n, bulkTestRows)
	}
	dl.db.Exec(`DROP TRIGGER fail_b`)
	removed, err := repo.DeleteByIDs(ctx, append(ids, 1<<40))
	if err != nil || len(removed) != bulkTestRows || removed[0].FileName == nil {
		t.Fatalf("removed=%d err=%v; the removed rows (with file names) must be returned", len(removed), err)
	}
}

func TestThumbnailGalleryRepo_BulkOps(t *testing.T) {
	ctx := context.Background()
	dl := openTestDB(t)
	repo := NewThumbnailGalleryRepo(dl.db)
	lib := NewLibraryRepo(dl.db)
	item, err := lib.Create(ctx, &models.LibraryItem{Title: "i", Status: "ghost"})
	if err != nil {
		t.Fatal(err)
	}
	otherItem, err := lib.Create(ctx, &models.LibraryItem{Title: "o", Status: "ghost"})
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]int64, bulkTestRows)
	for i := range ids {
		id, err := repo.Create(ctx, item, fmt.Sprintf("g/%d.jpg", i), nil, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = id
	}
	foreign, _ := repo.Create(ctx, otherItem, "g/x.jpg", nil, nil, nil)

	favorites := func() int {
		var n int
		dl.db.QueryRow(`SELECT COUNT(*) FROM thumbnail_gallery WHERE is_favorite = 1`).Scan(&n)
		return n
	}

	t.Run("foreign and missing ids are reported and nothing changes", func(t *testing.T) {
		n, foreignIDs, missing, err := repo.SetFavoriteForItem(ctx, item, []int64{ids[0], foreign, 1 << 40}, true)
		if err != nil || n != 0 || len(foreignIDs) != 1 || foreignIDs[0] != foreign || len(missing) != 1 {
			t.Fatalf("n=%d foreign=%v missing=%v err=%v", n, foreignIDs, missing, err)
		}
		if favorites() != 0 {
			t.Fatal("rows changed")
		}
		removed, foreignIDs, err := repo.DeleteForItem(ctx, item, []int64{ids[0], foreign})
		if err != nil || removed != nil || len(foreignIDs) != 1 {
			t.Fatalf("removed=%v foreign=%v err=%v", removed, foreignIDs, err)
		}
		if countRows(t, dl, "thumbnail_gallery") != bulkTestRows+1 {
			t.Fatal("rows deleted by a rejected request")
		}
	})

	t.Run("favorite: failure in a later chunk rolls back, then success", func(t *testing.T) {
		failOn(t, dl, fmt.Sprintf(`CREATE TRIGGER fail_g BEFORE UPDATE ON thumbnail_gallery WHEN OLD.id = %d BEGIN SELECT RAISE(ABORT, 'injected'); END`, ids[len(ids)-1]))
		if _, _, _, err := repo.SetFavoriteForItem(ctx, item, ids, true); err == nil {
			t.Fatal("expected the injected failure")
		}
		if favorites() != 0 {
			t.Fatal("favorites changed although the transaction failed")
		}
		dl.db.Exec(`DROP TRIGGER fail_g`)
		n, _, _, err := repo.SetFavoriteForItem(ctx, item, ids, true)
		if err != nil || n != bulkTestRows || favorites() != bulkTestRows {
			t.Fatalf("n=%d err=%v favorites=%d", n, err, favorites())
		}
	})

	t.Run("delete: failure rolls back; unknown ids are ignored; rows are returned", func(t *testing.T) {
		failOn(t, dl, fmt.Sprintf(`CREATE TRIGGER fail_gd BEFORE DELETE ON thumbnail_gallery WHEN OLD.id = %d BEGIN SELECT RAISE(ABORT, 'injected'); END`, ids[len(ids)-1]))
		if removed, _, err := repo.DeleteForItem(ctx, item, ids); err == nil || removed != nil {
			t.Fatalf("removed=%v err=%v, want the injected failure", removed, err)
		}
		if countRows(t, dl, "thumbnail_gallery") != bulkTestRows+1 {
			t.Fatal("rows deleted although the transaction failed")
		}
		dl.db.Exec(`DROP TRIGGER fail_gd`)
		removed, foreignIDs, err := repo.DeleteForItem(ctx, item, append(ids, 1<<40))
		if err != nil || len(foreignIDs) != 0 || len(removed) != bulkTestRows || removed[0].ImagePath == "" {
			t.Fatalf("removed=%d foreign=%v err=%v", len(removed), foreignIDs, err)
		}
		if countRows(t, dl, "thumbnail_gallery") != 1 {
			t.Fatal("the other item's image must survive")
		}
	})
}

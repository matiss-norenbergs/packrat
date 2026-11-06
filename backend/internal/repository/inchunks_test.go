package repository

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"packrat/backend/internal/models"
)

// bigN is well past SQLite's 32,766 bound-variable limit, even with one
// placeholder per id.
const bigN = 40000

// bigIDList returns bigN ids, mostly non-existent, with the given real ids
// spread across the list so they land in different chunks.
func bigIDList(real ...int64) []int64 {
	ids := make([]int64, 0, bigN)
	for i := int64(0); i < int64(bigN-len(real)); i++ {
		ids = append(ids, 1_000_000+i)
	}
	for i, id := range real {
		pos := i * len(ids) / len(real)
		ids = append(ids, 0)
		copy(ids[pos+1:], ids[pos:])
		ids[pos] = id
	}
	return ids
}

func TestInChunks(t *testing.T) {
	var calls [][]int
	err := inChunks([]int{1, 2, 3, 4, 5}, 2, func(c []int) error {
		calls = append(calls, append([]int(nil), c...))
		return nil
	})
	if err != nil || len(calls) != 3 || len(calls[2]) != 1 {
		t.Fatalf("unexpected chunks %v err %v", calls, err)
	}

	called := false
	if err := inChunks([]int{}, 2, func([]int) error { called = true; return nil }); err != nil || called {
		t.Fatalf("empty input must not call fn")
	}

	boom := errors.New("boom")
	n := 0
	err = inChunks([]int{1, 2, 3, 4}, 1, func([]int) error { n++; return boom })
	if !errors.Is(err, boom) || n != 1 {
		t.Fatalf("expected to stop at first error, n=%d err=%v", n, err)
	}
}

func TestLargeIDLists(t *testing.T) {
	ctx := context.Background()
	dl := openTestDB(t)
	conn := dl.db
	lib := NewLibraryRepo(conn)
	tags := NewTagsRepo(conn)
	gallery := NewThumbnailGalleryRepo(conn)
	subs := NewSubscriptionsRepo(conn)

	var itemIDs []int64
	for i := 0; i < 3; i++ {
		u := fmt.Sprintf("https://example.com/%d", i)
		vid := fmt.Sprintf("vid%d", i)
		id, err := lib.Create(ctx, &models.LibraryItem{
			Title: fmt.Sprintf("T%d", i), Filename: fmt.Sprintf("f%d.mp4", i), Path: fmt.Sprintf("f%d.mp4", i),
			OriginalURL: &u, VideoID: &vid, Status: "completed",
		})
		if err != nil {
			t.Fatal(err)
		}
		itemIDs = append(itemIDs, id)
	}
	ids := bigIDList(itemIDs...)

	t.Run("TagsAndSetForLibraryItems", func(t *testing.T) {
		tagIDs, err := tags.GetOrCreateByNames(ctx, []string{"b", "a"})
		if err != nil {
			t.Fatal(err)
		}
		if err := tags.SetForLibraryItems(ctx, ids, tagIDs); err != nil {
			t.Fatalf("SetForLibraryItems with %d ids: %v", len(ids), err)
		}
		got, err := tags.TagsByLibraryIDs(ctx, ids)
		if err != nil {
			t.Fatalf("TagsByLibraryIDs: %v", err)
		}
		if len(got) != 3 {
			t.Fatalf("expected tags for 3 items, got %d", len(got))
		}
		for _, id := range itemIDs {
			if fmt.Sprint(got[id]) != "[a b]" {
				t.Errorf("item %d tags = %v, want [a b] (ordered)", id, got[id])
			}
		}
	})

	t.Run("CountsByLibraryItemIDs", func(t *testing.T) {
		if _, err := gallery.Create(ctx, itemIDs[0], "a.jpg", nil, nil, nil); err != nil {
			t.Fatal(err)
		}
		if _, err := gallery.Create(ctx, itemIDs[2], "b.jpg", nil, nil, nil); err != nil {
			t.Fatal(err)
		}
		got, err := gallery.CountsByLibraryItemIDs(ctx, ids)
		if err != nil {
			t.Fatalf("CountsByLibraryItemIDs: %v", err)
		}
		if len(got) != 2 || got[itemIDs[0]] != 1 || got[itemIDs[2]] != 1 {
			t.Fatalf("unexpected counts %v", got)
		}
	})

	t.Run("GetByIDs", func(t *testing.T) {
		var dlIDs []int64
		for i := 0; i < 2; i++ {
			id, err := dl.Create(ctx, &models.Download{URL: fmt.Sprintf("https://example.com/d%d", i), DownloadType: "video", Quality: "best", Status: models.StatusQueued})
			if err != nil {
				t.Fatal(err)
			}
			dlIDs = append(dlIDs, id)
		}
		got, err := dl.GetByIDs(ctx, bigIDList(dlIDs...))
		if err != nil {
			t.Fatalf("GetByIDs: %v", err)
		}
		if len(got) != 2 || got[dlIDs[0]] == nil || got[dlIDs[1]] == nil {
			t.Fatalf("unexpected result %v", got)
		}
	})

	t.Run("ActiveDownloadIDsByLibraryItem", func(t *testing.T) {
		did, err := dl.Create(ctx, &models.Download{URL: "https://example.com/active", DownloadType: "video", Quality: "best", Status: models.StatusQueued})
		if err != nil {
			t.Fatal(err)
		}
		if err := dl.SetGhostLibraryItem(ctx, did, itemIDs[1]); err != nil {
			t.Fatal(err)
		}
		got, err := dl.ActiveDownloadIDsByLibraryItem(ctx, ids)
		if err != nil {
			t.Fatalf("ActiveDownloadIDsByLibraryItem: %v", err)
		}
		if len(got) != 1 || got[itemIDs[1]] != did {
			t.Fatalf("unexpected result %v (want %d -> %d)", got, itemIDs[1], did)
		}
	})

	t.Run("HasSeenEntries", func(t *testing.T) {
		subID, err := subs.Create(ctx, &models.Subscription{URL: "https://example.com/c", Title: "c", MediaType: "video", CheckIntervalHours: 6, Enabled: true})
		if err != nil {
			t.Fatal(err)
		}
		for _, s := range []string{"seen-first", "seen-last"} {
			if err := subs.RecordSeenEntry(ctx, subID, s, "t", "u", 0, nil); err != nil {
				t.Fatal(err)
			}
		}
		src := make([]string, 0, bigN)
		src = append(src, "seen-first")
		for i := 0; i < bigN; i++ {
			src = append(src, fmt.Sprintf("unseen-%d", i))
		}
		src = append(src, "seen-last")
		got, err := subs.HasSeenEntries(ctx, subID, src)
		if err != nil {
			t.Fatalf("HasSeenEntries: %v", err)
		}
		if len(got) != 2 || !got["seen-first"] || !got["seen-last"] {
			t.Fatalf("unexpected result %v", got)
		}
	})

	t.Run("FindDuplicates", func(t *testing.T) {
		queries := make([]DuplicateQuery, 0, bigN+2)
		queries = append(queries, DuplicateQuery{URL: "https://example.com/0"})
		for i := 0; i < bigN; i++ {
			queries = append(queries, DuplicateQuery{URL: fmt.Sprintf("https://nope.example/%d", i), VideoID: fmt.Sprintf("nope%d", i)})
		}
		queries = append(queries, DuplicateQuery{VideoID: "vid2"})
		got, err := lib.FindDuplicates(ctx, queries)
		if err != nil {
			t.Fatalf("FindDuplicates: %v", err)
		}
		last := len(queries) - 1
		if len(got) != 2 || got[0] == nil || got[0].ID != itemIDs[0] || got[last] == nil || got[last].ID != itemIDs[2] {
			t.Fatalf("unexpected result %v", got)
		}
	})

	t.Run("QueryCollectionIDs", func(t *testing.T) {
		cols := NewCollectionsRepo(conn)
		cid, err := cols.Create(ctx, &models.Collection{Name: "C", RootPath: "C", DefaultQuality: "best", DefaultDownloadType: "video"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := conn.ExecContext(ctx, `UPDATE library SET collection_id = ? WHERE id = ?`, cid, itemIDs[0]); err != nil {
			t.Fatal(err)
		}
		items, total, err := lib.Query(ctx, LibraryQuery{CollectionIDs: bigIDList(cid)})
		if err != nil {
			t.Fatalf("Query with %d collection ids: %v", bigN, err)
		}
		if total != 1 || len(items) != 1 || items[0].ID != itemIDs[0] {
			t.Fatalf("unexpected result total=%d items=%v", total, items)
		}
	})
}

func TestEmptyIDListsReturnWithoutQuerying(t *testing.T) {
	ctx := context.Background()
	dl := openTestDB(t)
	// A closed connection fails any query, so success proves none was made.
	dl.db.Close()

	if m, err := dl.ActiveDownloadIDsByLibraryItem(ctx, nil); err != nil || len(m) != 0 {
		t.Errorf("ActiveDownloadIDsByLibraryItem: %v %v", m, err)
	}
	if m, err := dl.GetByIDs(ctx, nil); err != nil || len(m) != 0 {
		t.Errorf("GetByIDs: %v %v", m, err)
	}
	if m, err := NewTagsRepo(dl.db).TagsByLibraryIDs(ctx, nil); err != nil || len(m) != 0 {
		t.Errorf("TagsByLibraryIDs: %v %v", m, err)
	}
	if err := NewTagsRepo(dl.db).SetForLibraryItems(ctx, nil, []int64{1}); err != nil {
		t.Errorf("SetForLibraryItems: %v", err)
	}
	if m, err := NewThumbnailGalleryRepo(dl.db).CountsByLibraryItemIDs(ctx, nil); err != nil || len(m) != 0 {
		t.Errorf("CountsByLibraryItemIDs: %v %v", m, err)
	}
	if m, err := NewSubscriptionsRepo(dl.db).HasSeenEntries(ctx, 1, nil); err != nil || len(m) != 0 {
		t.Errorf("HasSeenEntries: %v %v", m, err)
	}
	if m, err := NewLibraryRepo(dl.db).FindDuplicates(ctx, nil); err != nil || len(m) != 0 {
		t.Errorf("FindDuplicates: %v %v", m, err)
	}
}

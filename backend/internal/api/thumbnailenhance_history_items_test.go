package api

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/thumbnailenhance"
)

// The history page used to load the whole library (LibraryRepo.List) to map at
// most 25 rows to their items; it now fetches just those items. This builds the
// expected blurred / enhancedPath for every row the OLD way (from List) and
// compares it with the endpoint's answer on a library of several hundred items.
//
// "Does not call List" is proven without a repo wrapper (LibraryRepo is a
// concrete type): after the expected values are computed, a library row that
// List cannot scan (unparseable downloaded_at) is inserted. The history rows
// never point at it, so the endpoint succeeds only if it no longer reads the
// whole library.
func TestThumbnailEnhancementHistoryFetchesOnlyPageItems(t *testing.T) {
	f := newPrivacyFixture(t)
	privateCol := f.collection("vault", nil, true)
	f.tag("secret", true)

	const libSize = 400
	itemIDs := make([]int64, 0, libSize)
	for i := 0; i < libSize; i++ {
		var coll *int64
		var tags []string
		switch {
		case i%7 == 0:
			coll = privateCol
		case i%11 == 0:
			tags = []string{"secret"}
		}
		id := f.item(fmt.Sprintf("item-%03d", i), coll, tags...)
		thumb := fmt.Sprintf("thumbs/%d.jpg", i)
		if _, err := f.conn.ExecContext(f.ctx, `UPDATE library SET thumbnail = ? WHERE id = ?`, thumb, id); err != nil {
			t.Fatal(err)
		}
		itemIDs = append(itemIDs, id)
	}

	history := repository.NewThumbnailEnhancementHistoryRepo(f.conn)
	deps := thumbnailenhance.Deps{
		SettingsRepo:  f.settings,
		LibraryRepo:   f.library,
		HistoryRepo:   history,
		OriginalsRepo: repository.NewThumbnailEnhancementOriginalsRepo(f.conn),
	}
	// 30 rows (page 1 holds 25): a spread of items, a repeated item and rows
	// with no item (the history table's foreign key nulls a deleted item's id,
	// so a dangling id cannot exist).
	for i := 0; i < 30; i++ {
		var id *int64
		switch {
		case i == 3 || i == 4:
			id = nil
		case i == 5:
			id = &itemIDs[14] // same item as i == 6
		default:
			id = &itemIDs[(i*13)%libSize]
		}
		if i == 6 {
			id = &itemIDs[14]
		}
		if _, err := history.Create(f.ctx, &models.ThumbnailEnhancementHistoryEntry{
			LibraryItemID: id, ItemTitle: fmt.Sprintf("row-%02d", i), Status: "success", TriggerType: "manual", Mode: "upscale",
		}); err != nil {
			t.Fatal(err)
		}
	}
	f.setPrivacy(true)

	// Reference: the old approach.
	type ref struct {
		blurred  bool
		enhanced string
	}
	entries, total, err := history.Query(f.ctx, repository.ThumbnailEnhancementHistoryQuery{Page: 1, PageSize: thumbnailEnhancementHistoryPageSize})
	if err != nil {
		t.Fatal(err)
	}
	all, err := f.library.List(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	oldByID := map[int64]models.LibraryItem{}
	for _, it := range all {
		oldByID[it.ID] = it
	}
	var present []int64
	for _, e := range entries {
		if e.LibraryItemID != nil {
			if _, ok := oldByID[*e.LibraryItemID]; ok {
				present = append(present, *e.LibraryItemID)
			}
		}
	}
	tagsByID, err := f.tags.TagsByLibraryIDs(f.ctx, present)
	if err != nil {
		t.Fatal(err)
	}
	privacy, err := LoadItemPrivacy(f.ctx, f.settings, f.collections, f.tags, f.artists)
	if err != nil {
		t.Fatal(err)
	}
	want := map[int64]ref{}
	anyBlurred := false
	for _, e := range entries {
		if e.LibraryItemID == nil {
			continue
		}
		if it, ok := oldByID[*e.LibraryItemID]; ok {
			r := ref{blurred: privacy.Blurred(it.CollectionID, it.ArtistID, tagsByID[it.ID])}
			if it.Thumbnail != nil {
				r.enhanced = *it.Thumbnail
			}
			anyBlurred = anyBlurred || r.blurred
			want[e.ID] = r
		}
	}
	if !anyBlurred || len(want) < 20 {
		t.Fatalf("fixture too weak: %d rows with items, anyBlurred=%v", len(want), anyBlurred)
	}

	// Poison: List now fails; GetByIDs for the page's ids must not care.
	if _, err := f.conn.ExecContext(f.ctx, `INSERT INTO library (title, filename, path, status, downloaded_at) VALUES ('poison', 'p.mp4', 'p.mp4', 'completed', 'not-a-time')`); err != nil {
		t.Fatal(err)
	}
	if _, err := f.library.List(f.ctx); err == nil {
		t.Fatal("fixture error: List should fail on the poison row")
	}

	mount := func(r *gin.Engine) {
		r.GET("/api/thumbnail-enhancement/history", ListThumbnailEnhancementHistory(deps, f.collections, f.tags, f.artists))
	}
	var got ThumbnailEnhancementHistoryListResponse
	w := serve(t, mount, http.MethodGet, "/api/thumbnail-enhancement/history", &got)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if got.Total != total || len(got.Entries) != len(entries) {
		t.Fatalf("total %d/%d, rows %d/%d", got.Total, total, len(got.Entries), len(entries))
	}
	for i, e := range got.Entries {
		if e.ID != entries[i].ID {
			t.Fatalf("row %d: id %d, want %d (order changed)", i, e.ID, entries[i].ID)
		}
		w, hasItem := want[e.ID]
		if !hasItem {
			if e.Blurred || e.EnhancedThumbnailPath != nil {
				t.Errorf("row %d (no live item) should be unblurred with no enhancedPath: %+v", e.ID, e)
			}
			continue
		}
		if e.Blurred != w.blurred {
			t.Errorf("row %d blurred = %v, want %v", e.ID, e.Blurred, w.blurred)
		}
		if e.EnhancedThumbnailPath == nil || *e.EnhancedThumbnailPath != w.enhanced {
			t.Errorf("row %d enhancedPath = %v, want %q", e.ID, e.EnhancedThumbnailPath, w.enhanced)
		}
	}
}

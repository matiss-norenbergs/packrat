package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
)

type updateEntry = map[string]any

func updateBody(t *testing.T, entries ...updateEntry) string {
	t.Helper()
	return bkJSON(t, map[string]any{"items": entries})
}

func upd(id int64, changes map[string]any) updateEntry {
	return updateEntry{"id": id, "changes": changes}
}

func (e *bkEnv) lastEmbedFor(name string) []string {
	var out []string
	for _, l := range e.embedLines() {
		if strings.Contains(l, name+".mp4") || strings.Contains(l, "/"+name) {
			out = append(out, l)
		}
	}
	return out
}

// Every field the old PATCH /api/library/:id body carried still works through
// the bulk endpoint, for one item (a one-element list).
func TestBulkUpdateLibraryItems_EveryField(t *testing.T) {
	e := newBkEnv(t)
	ctx := t.Context()
	id := e.item("orig")
	artist, err := e.artists.Create(ctx, "Some Artist", nil)
	if err != nil {
		t.Fatal(err)
	}

	w := e.post("/library/bulk-update", updateBody(t, upd(id, map[string]any{
		"title": "New title", "filename": "renamed", "uploader": "up", "description": "desc",
		"duration": 61, "resolution": "1920x1080", "artistId": artist.ID, "year": 1999,
		"sequenceNumber": 4, "seasonNumber": 2, "generateNfo": true,
		"originalUrl": "  https://example.test/orig  ", "tags": []string{"alpha", "beta"},
	})))
	e.want(w, http.StatusOK)
	got := bkDecode[BulkResultsResponse[int64]](t, w)
	if got.Succeeded != 1 || got.Failed != 0 || len(got.Results) != 1 || !got.Results[0].OK || got.Results[0].ID != id {
		t.Fatalf("response = %+v", got)
	}

	it, err := e.library.Get(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	str := func(p *string) string {
		if p == nil {
			return "<nil>"
		}
		return *p
	}
	num := func(p *int) int {
		if p == nil {
			return -1
		}
		return *p
	}
	switch {
	case it.Title != "New title", it.Filename != "renamed.mp4", it.Path != "renamed.mp4",
		str(it.Uploader) != "up", str(it.Description) != "desc", num(it.Duration) != 61, str(it.Resolution) != "1920x1080",
		it.ArtistID == nil || *it.ArtistID != artist.ID, num(it.ReleaseYear) != 1999,
		num(it.SequenceNumber) != 4, num(it.SeasonNumber) != 2, !it.GenerateNFO,
		str(it.OriginalURL) != "https://example.test/orig":
		t.Fatalf("item after update = %+v", it)
	}
	if _, err := os.Stat(filepath.Join(e.mediaRoot, "renamed.mp4")); err != nil {
		t.Fatalf("media file was not renamed on disk: %v", err)
	}
	if _, err := os.Stat(filepath.Join(e.mediaRoot, "orig.mp4")); !os.IsNotExist(err) {
		t.Fatalf("old file name still exists: %v", err)
	}
	tags, _ := e.tags.TagsForLibraryItem(ctx, id)
	slices.Sort(tags)
	if !slices.Equal(tags, []string{"alpha", "beta"}) {
		t.Fatalf("tags = %v", tags)
	}
	if _, err := os.Stat(filepath.Join(e.mediaRoot, "renamed.nfo")); err != nil {
		t.Fatalf("NFO sidecar was not written: %v", err)
	}
	if lines := e.embedLines(); len(lines) != 1 || !strings.Contains(lines[0], "title=New title") || !strings.Contains(lines[0], "artist=Some Artist") ||
		!strings.Contains(lines[0], "date=1999") || !strings.Contains(lines[0], "track=4") || !strings.Contains(lines[0], "season_number=2") {
		t.Fatalf("embed log = %q, want one embed carrying every tag", lines)
	}

	// Clearing: artistId 0, year/season/sequence 0, empty originalUrl, empty tag list.
	w = e.post("/library/bulk-update", updateBody(t, upd(id, map[string]any{
		"artistId": 0, "year": 0, "sequenceNumber": 0, "seasonNumber": 0, "originalUrl": "", "tags": []string{}, "generateNfo": false,
	})))
	e.want(w, http.StatusOK)
	it, _ = e.library.Get(ctx, id)
	if it.ArtistID != nil || it.ReleaseYear != nil || it.SequenceNumber != nil || it.SeasonNumber != nil || it.OriginalURL != nil || it.GenerateNFO {
		t.Fatalf("fields were not cleared: %+v", it)
	}
	if tags, _ := e.tags.TagsForLibraryItem(ctx, id); len(tags) != 0 {
		t.Fatalf("tags not cleared: %v", tags)
	}
	// Fields left out stay as they were.
	if it.Title != "New title" || str(it.Uploader) != "up" {
		t.Fatalf("omitted fields changed: %+v", it)
	}
}

// Several items in one request: each gets its own changes and its own single
// metadata embed.
func TestBulkUpdateLibraryItems_SeveralItemsEmbedOncePerItem(t *testing.T) {
	e := newBkEnv(t)
	ctx := t.Context()
	a, b, c := e.item("aa"), e.item("bb"), e.item("cc")

	w := e.post("/library/bulk-update", updateBody(t,
		upd(a, map[string]any{"title": "A2", "year": 2001}),
		upd(b, map[string]any{"title": "B2", "seasonNumber": 3}),
		upd(c, map[string]any{"description": "only a description"}), // nothing the file embeds
	))
	e.want(w, http.StatusOK)
	got := bkDecode[BulkResultsResponse[int64]](t, w)
	if got.Succeeded != 3 || got.Failed != 0 {
		t.Fatalf("%+v", got)
	}
	for i, id := range []int64{a, b, c} {
		if got.Results[i].ID != id || !got.Results[i].OK {
			t.Fatalf("result %d = %+v", i, got.Results[i])
		}
	}
	if it, _ := e.library.Get(ctx, a); it.Title != "A2" {
		t.Fatalf("a = %+v", it)
	}
	if it, _ := e.library.Get(ctx, c); it.Title != "cc" || it.Description == nil || *it.Description != "only a description" {
		t.Fatalf("c = %+v", it)
	}
	lines := e.embedLines()
	if len(lines) != 2 {
		t.Fatalf("embeds = %d (%q), want exactly one per item that changed an embedded field", len(lines), lines)
	}
	joined := strings.Join(lines, "\n")
	if strings.Count(joined, "title=A2") != 1 || strings.Count(joined, "title=B2") != 1 {
		t.Fatalf("embeds = %q", lines)
	}
}

// A mix of outcomes in one request: HTTP 200, one entry per item in request
// order, and a failing item does not stop the rest.
func TestBulkUpdateLibraryItems_PerItemResults(t *testing.T) {
	e := newBkEnv(t)
	ctx := t.Context()
	ok1 := e.item("ok1")
	busy := e.item("busy")
	downloading := e.item("downloading")
	collide := e.item("collide")
	e.item("taken") // collide -> taken.mp4 already exists
	ok2 := e.item("ok2")
	ghost, err := e.library.Create(ctx, &models.LibraryItem{Title: "ghost", Status: "ghost"})
	if err != nil {
		t.Fatal(err)
	}

	dl := e.download(models.StatusDownloading)
	if _, err := e.conn.ExecContext(ctx, `UPDATE downloads SET target_library_item_id = ? WHERE id = ?`, downloading, dl); err != nil {
		t.Fatal(err)
	}
	locks := e.mgr.ItemLocks()
	if !locks.TryLock(busy) {
		t.Fatal("could not lock the item")
	}
	released := false
	release := func() {
		if !released {
			released = true
			locks.Unlock(busy)
		}
	}
	defer release()

	const missing = int64(987654)
	w := e.post("/library/bulk-update", updateBody(t,
		upd(ok1, map[string]any{"title": "ok1 new"}),
		upd(busy, map[string]any{"filename": "busy-renamed", "title": "busy new"}),
		upd(missing, map[string]any{"title": "x"}),
		upd(downloading, map[string]any{"title": "dl new"}),
		upd(collide, map[string]any{"filename": "taken"}),
		upd(ghost, map[string]any{"filename": "ghost-file"}),
		upd(ok2, map[string]any{"title": "ok2 new", "filename": "ok2-renamed"}),
	))
	e.want(w, http.StatusOK)
	got := bkDecode[BulkResultsResponse[int64]](t, w)
	if got.Succeeded != 2 || got.Failed != 5 || len(got.Results) != 7 {
		t.Fatalf("succeeded/failed = %d/%d, results %+v", got.Succeeded, got.Failed, got.Results)
	}
	want := []struct {
		id     int64
		ok     bool
		status int
	}{
		{ok1, true, 0}, {busy, false, 409}, {missing, false, 404}, {downloading, false, 409},
		{collide, false, 409}, {ghost, false, 400}, {ok2, true, 0},
	}
	for i, wnt := range want {
		r := got.Results[i]
		if r.ID != wnt.id || r.OK != wnt.ok || r.Status != wnt.status || (!wnt.ok && r.Error == "") {
			t.Fatalf("result %d = %+v, want id=%d ok=%v status=%d", i, r, wnt.id, wnt.ok, wnt.status)
		}
	}
	if got.Results[1].Error != itemBusyMessage {
		t.Fatalf("busy message = %q, want %q", got.Results[1].Error, itemBusyMessage)
	}
	if !strings.Contains(got.Results[3].Error, "download is already in progress") {
		t.Fatalf("downloading message = %q", got.Results[3].Error)
	}

	// Succeeded items were applied (including the one AFTER the failures)...
	if it, _ := e.library.Get(ctx, ok1); it.Title != "ok1 new" {
		t.Fatalf("ok1 = %+v", it)
	}
	if it, _ := e.library.Get(ctx, ok2); it.Title != "ok2 new" || it.Filename != "ok2-renamed.mp4" {
		t.Fatalf("ok2 = %+v", it)
	}
	// ...failed ones were not touched.
	if it, _ := e.library.Get(ctx, busy); it.Title != "busy" || it.Filename != "busy.mp4" {
		t.Fatalf("busy item changed: %+v", it)
	}
	if it, _ := e.library.Get(ctx, downloading); it.Title != "downloading" {
		t.Fatalf("downloading item changed: %+v", it)
	}
	if it, _ := e.library.Get(ctx, collide); it.Filename != "collide.mp4" {
		t.Fatalf("colliding rename changed the row: %+v", it)
	}
	if _, err := os.Stat(filepath.Join(e.mediaRoot, "collide.mp4")); err != nil {
		t.Fatalf("colliding rename moved the file: %v", err)
	}
	e.mgr.Embedder().Wait() // background embeds hold their item's lock while they run
	if locks.Len() != 1 {   // only our own hold on `busy`
		t.Fatalf("lock entries = %d, want 1 (no leaks)", locks.Len())
	}

	// Once the lock is released, the same request succeeds for that item.
	release()
	w = e.post("/library/bulk-update", updateBody(t, upd(busy, map[string]any{"filename": "busy-renamed"})))
	e.want(w, http.StatusOK)
	if got := bkDecode[BulkResultsResponse[int64]](t, w); got.Succeeded != 1 {
		t.Fatalf("after release: %+v", got)
	}
	if locks.Len() != 0 {
		t.Fatalf("lock entries leaked: %d", locks.Len())
	}
}

// A duplicate id makes the two changes ambiguous: 400, nothing applied.
func TestBulkUpdateLibraryItems_DuplicateIDIs400(t *testing.T) {
	e := newBkEnv(t)
	a, b := e.item("a1"), e.item("b1")
	w := e.post("/library/bulk-update", updateBody(t,
		upd(a, map[string]any{"title": "first"}),
		upd(b, map[string]any{"title": "other"}),
		upd(a, map[string]any{"title": "second"}),
	))
	e.want(w, http.StatusBadRequest)
	for _, id := range []int64{a, b} {
		if it, _ := e.library.Get(t.Context(), id); strings.Contains(it.Title, "first") || strings.Contains(it.Title, "second") || it.Title == "other" {
			t.Fatalf("item %d changed by a rejected request: %+v", id, it)
		}
	}
}

// The batch runs on a context that survives the client going away, so a closed
// tab cannot leave half of it undone.
func TestBulkUpdateLibraryItems_SurvivesClientDisconnect(t *testing.T) {
	e := newBkEnv(t)
	a, b := e.item("c1"), e.item("c2")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/library/bulk-update", BulkUpdateLibraryItems(e.library, e.mediaRoot, e.mgr, e.tags, e.artists, e.downloads))
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // the client is already gone when the handler runs
	req := httptest.NewRequest(http.MethodPost, "/library/bulk-update",
		strings.NewReader(updateBody(t, upd(a, map[string]any{"title": "kept 1"}), upd(b, map[string]any{"title": "kept 2"}))))
	req = req.WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	e.want(w, http.StatusOK)
	if got := bkDecode[BulkResultsResponse[int64]](t, w); got.Succeeded != 2 || got.Failed != 0 {
		t.Fatalf("%+v", got)
	}
	for id, title := range map[int64]string{a: "kept 1", b: "kept 2"} {
		if it, _ := e.library.Get(context.Background(), id); it.Title != title {
			t.Fatalf("item %d = %+v, want the batch applied despite the cancelled request", id, it)
		}
	}
}

// Sanity: the id list is in the response even for items that were never touched.
func TestBulkUpdateLibraryItems_EmptyChangesIsASuccess(t *testing.T) {
	e := newBkEnv(t)
	a := e.item("noop")
	w := e.post("/library/bulk-update", fmt.Sprintf(`{"items":[{"id":%d}]}`, a))
	e.want(w, http.StatusOK)
	if got := bkDecode[BulkResultsResponse[int64]](t, w); got.Succeeded != 1 {
		t.Fatalf("%+v", got)
	}
	if lines := e.embedLines(); len(lines) != 0 {
		t.Fatalf("an empty change must not embed: %q", lines)
	}
}

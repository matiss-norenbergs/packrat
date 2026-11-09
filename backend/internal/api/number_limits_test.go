package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"packrat/backend/internal/backup"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

var limit = models.MaxSequenceValue

type httpResult struct{ *httptest.ResponseRecorder }

// collectionID creates a root collection directly in the database.
func (e *bkEnv) collectionID(name string) (int64, error) {
	return repository.NewCollectionsRepo(e.conn).Create(context.Background(), &models.Collection{
		Name: name, RootPath: name, DefaultQuality: "best", DefaultDownloadType: "video",
	})
}

// Every endpoint that takes a season / sequence number (or a collection's
// sequenceMin / sequenceMax) accepts the limit and refuses one above it (and
// negatives) with a 400 that names the field.
func TestNumberLimitsAtEveryEndpoint(t *testing.T) {
	e := newBkEnv(t)
	n := 0
	uniq := func(prefix string) string { n++; return fmt.Sprintf("%s%d", prefix, n) }

	type endpoint struct {
		name   string
		fields []string
		send   func(field string, value int) *httpResult
	}
	// One request per (endpoint, field, value); every other field stays valid.
	download := func(field string, v int) *httpResult {
		body := map[string]any{"url": "https://example.test/" + uniq("v"), "downloadType": "video", field: v}
		return &httpResult{e.post("/downloads", bkJSON(t, body))}
	}
	batch := func(field string, v int) *httpResult {
		body := map[string]any{"items": []map[string]any{
			{"url": "https://example.test/" + uniq("ok"), "downloadType": "video"},
			{"url": "https://example.test/" + uniq("b"), "downloadType": "video", field: v},
		}}
		return &httpResult{e.post("/downloads/batch", bkJSON(t, body))}
	}
	ghost := func(field string, v int) *httpResult {
		body := map[string]any{"title": uniq("ghost"), "mediaType": "video", field: v}
		return &httpResult{e.post("/library/ghost", bkJSON(t, body))}
	}
	createCol := func(field string, v int) *httpResult {
		body := map[string]any{"name": uniq("col"), "rootPath": uniq("col"), field: v}
		return &httpResult{e.post("/collections", bkJSON(t, body))}
	}
	updateCol := func(field string, v int) *httpResult {
		id, err := e.collectionID(uniq("upd"))
		if err != nil {
			t.Fatal(err)
		}
		body := map[string]any{"name": uniq("renamed"), "rootPath": uniq("renamed"), field: v}
		return &httpResult{e.send(http.MethodPatch, fmt.Sprintf("/api/collections/%d", id), bkJSON(t, body), true)}
	}

	endpoints := []endpoint{
		{"POST /downloads", []string{"seasonNumber", "sequenceNumber"}, download},
		{"POST /downloads/batch", []string{"seasonNumber", "sequenceNumber"}, batch},
		{"POST /library/ghost", []string{"seasonNumber", "sequenceNumber"}, ghost},
		{"POST /collections", []string{"seasonNumber", "sequenceMin", "sequenceMax"}, createCol},
		{"PATCH /collections/:id", []string{"seasonNumber", "sequenceMin", "sequenceMax"}, updateCol},
	}
	for _, ep := range endpoints {
		for _, field := range ep.fields {
			t.Run(ep.name+" "+field, func(t *testing.T) {
				if r := ep.send(field, limit); r.Code >= 300 {
					t.Fatalf("value %d (the limit): status %d %s", limit, r.Code, r.Body.String())
				}
				for _, bad := range []int{limit + 1, -1, 5_000_000_000} {
					r := ep.send(field, bad)
					if r.Code != http.StatusBadRequest {
						t.Fatalf("value %d: status %d %s, want 400", bad, r.Code, r.Body.String())
					}
					if !strings.Contains(r.Body.String(), field) || !strings.Contains(r.Body.String(), fmt.Sprint(limit)) {
						t.Errorf("value %d: message should name %s and the limit: %s", bad, field, r.Body.String())
					}
				}
			})
		}
	}
}

// bulk-update validates per item: the out-of-range item fails with its own 400,
// the rest of the request is applied, and nothing is written for the bad item.
func TestBulkUpdateNumberLimitsArePerItem(t *testing.T) {
	e := newBkEnv(t)
	good, bad, edge := e.item("good"), e.item("bad"), e.item("edge")
	w := e.post("/library/bulk-update", updateBody(t,
		upd(good, map[string]any{"title": "renamed ok", "sequenceNumber": 3}),
		upd(bad, map[string]any{"title": "must not apply", "sequenceNumber": limit + 1}),
		upd(edge, map[string]any{"seasonNumber": limit, "sequenceNumber": limit}),
	))
	e.want(w, http.StatusOK)
	got := bkDecode[BulkResultsResponse[int64]](t, w)
	if got.Succeeded != 2 || got.Failed != 1 || len(got.Results) != 3 {
		t.Fatalf("results = %+v", got)
	}
	r := got.Results[1]
	if r.ID != bad || r.OK || r.Status != http.StatusBadRequest || !strings.Contains(r.Error, "sequenceNumber") {
		t.Errorf("bad item's result = %+v", r)
	}
	if it, _ := e.library.Get(t.Context(), bad); it.Title == "must not apply" || it.SequenceNumber != nil {
		t.Errorf("the rejected item was changed: %+v", it)
	}
	if it, _ := e.library.Get(t.Context(), edge); it.SeasonNumber == nil || *it.SeasonNumber != limit || *it.SequenceNumber != limit {
		t.Errorf("an item at the limit was not saved: %+v", it)
	}
	// 0 still clears.
	e.want(e.post("/library/bulk-update", updateBody(t, upd(edge, map[string]any{"sequenceNumber": 0}))), http.StatusOK)
	if it, _ := e.library.Get(t.Context(), edge); it.SequenceNumber != nil {
		t.Errorf("0 should still clear the sequence number: %+v", it)
	}
}

// Library bundle import refuses an out-of-range entry (400, nothing applied)
// and accepts one at the limit.
func TestLibraryImportNumberLimits(t *testing.T) {
	e := newBkEnv(t)
	seq := func(n int) *int { return &n }
	send := func(item backup.LibraryItemEntry) int {
		bundle := backup.LibraryBundle{LibraryItems: []backup.LibraryItemEntry{item}}
		plain := []byte(bkJSON(t, bundle))
		env, err := backup.Seal("library", plain, "")
		if err != nil {
			t.Fatal(err)
		}
		w := e.post("/backup/import/library", bkJSON(t, map[string]any{"data": bkJSON(t, env), "mode": "ghostOnly"}))
		return w.Code
	}
	if code := send(backup.LibraryItemEntry{Title: "edge", SequenceNumber: seq(limit), SeasonNumber: seq(limit)}); code != http.StatusOK {
		t.Fatalf("at the limit: status %d", code)
	}
	if code := send(backup.LibraryItemEntry{Title: "too big", SequenceNumber: seq(limit + 1)}); code != http.StatusBadRequest {
		t.Fatalf("above the limit: status %d, want 400", code)
	}
	items, _ := e.library.List(t.Context())
	for _, it := range items {
		if it.Title == "too big" {
			t.Fatal("a refused import created an item")
		}
	}
}

// A collection whose bounds were stored before the limit existed (set straight
// in the database) must not slow or hang the list.
func TestListCollectionsWithAbsurdStoredBounds(t *testing.T) {
	e := newBkEnv(t)
	id, err := e.collectionID("wild")
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range []int{1, 3} {
		n := n
		if _, err := e.library.Create(context.Background(), &models.LibraryItem{Title: "i", Filename: "i.mp4", Path: "i.mp4", CollectionID: &id, SequenceNumber: &n, Status: "completed"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, v := range []string{"1000000000", "9223372036854775807"} {
		if _, err := e.conn.Exec(`UPDATE collections SET sequence_max = `+v+` WHERE id = ?`, id); err != nil {
			t.Fatal(err)
		}
		start := time.Now()
		w := e.send(http.MethodGet, "/api/collections", "", false)
		e.want(w, http.StatusOK)
		if d := time.Since(start); d > 3*time.Second {
			t.Fatalf("sequence_max %s: listing took %v", v, d)
		}
		cols := bkDecode[[]CollectionResponse](t, w)
		found := false
		for _, c := range cols {
			if c.ID == id {
				found = true
				if c.SequenceGaps == nil || c.SequenceGaps.Count <= 0 || len(c.SequenceGaps.Missing) != 50 {
					t.Errorf("gap for max %s = %+v", v, c.SequenceGaps)
				}
			}
		}
		if !found {
			t.Fatal("collection missing from the list")
		}
	}
}

package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"packrat/backend/internal/models"
)

// The removed single-item routes must not answer any more (404, or 405 where
// gin knows the path under another method).
func TestOldSingleItemRoutesAreGone(t *testing.T) {
	e := newBkEnv(t)
	for _, rt := range []struct{ method, path string }{
		{"DELETE", "/api/downloads/1"},
		{"DELETE", "/api/history/1"},
		{"POST", "/api/history/1/retry"},
		{"DELETE", "/api/subscriptions/1"},
		{"POST", "/api/subscriptions/1/entries/abc/add"},
		{"POST", "/api/subscriptions/1/entries/abc/seen"},
		{"POST", "/api/subscriptions/1/entries/abc/unlink"},
		{"DELETE", "/api/backup/history/1"},
		{"PATCH", "/api/library/1"},
		{"PATCH", "/api/library/1/thumbnail/gallery/2"},
		{"DELETE", "/api/library/1/thumbnail/gallery/2"},
	} {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			w := e.send(rt.method, rt.path, `{}`, true)
			if w.Code != http.StatusNotFound && w.Code != http.StatusMethodNotAllowed {
				t.Fatalf("status = %d, want 404/405: %s", w.Code, w.Body)
			}
		})
	}
	// The routes that stay (link, check) are still registered: they get past routing.
	if w := e.send("POST", "/api/subscriptions/1/entries/abc/link", `{}`, true); w.Code == http.StatusNotFound && !strings.Contains(w.Body.String(), "not found") {
		t.Fatalf("link route vanished: %d %s", w.Code, w.Body)
	}
}

// bulkEndpoint describes one new route for the shared request-validation table.
type bulkEndpoint struct {
	name, path string
	// key is the JSON list field; items=true means the list holds {"id":n} objects.
	key   string
	items bool
	// extra is merged into the body (mode, isFavorite, ...).
	extra string
}

func (b bulkEndpoint) body(n int) string {
	var parts []string
	for i := 1; i <= n; i++ {
		switch {
		case b.items:
			parts = append(parts, fmt.Sprintf(`{"id":%d,"changes":{}}`, i))
		case b.key == "sourceIds":
			parts = append(parts, fmt.Sprintf(`"s%d"`, i))
		default:
			parts = append(parts, fmt.Sprint(i))
		}
	}
	extra := ""
	if b.extra != "" {
		extra = "," + b.extra
	}
	return fmt.Sprintf(`{"%s":[%s]%s}`, b.key, strings.Join(parts, ","), extra)
}

var allBulkEndpoints = []bulkEndpoint{
	{"library update", "/library/bulk-update", "items", true, ""},
	{"downloads delete", "/downloads/bulk-delete", "ids", false, ""},
	{"history delete", "/history/bulk-delete", "ids", false, ""},
	{"history retry", "/history/bulk-retry", "ids", false, ""},
	{"subscriptions delete", "/subscriptions/bulk-delete", "ids", false, ""},
	{"entries seen", "/subscriptions/1/entries/bulk-seen", "sourceIds", false, ""},
	{"entries unlink", "/subscriptions/1/entries/bulk-unlink", "sourceIds", false, ""},
	{"entries add", "/subscriptions/1/entries/bulk-add", "sourceIds", false, `"mode":"ghost"`},
	{"backup delete", "/backup/history/bulk-delete", "ids", false, ""},
	{"gallery favorite", "/library/1/thumbnail/gallery/bulk-favorite", "galleryIds", false, `"isFavorite":true`},
	{"gallery delete", "/library/1/thumbnail/gallery/bulk-delete", "galleryIds", false, ""},
}

// Every new endpoint: empty list, more than 1000 entries and a malformed body
// are 400; a state-changing request without the CSRF header is refused.
func TestBulkEndpointsRequestValidation(t *testing.T) {
	e := newBkEnv(t)
	for _, ep := range allBulkEndpoints {
		t.Run(ep.name, func(t *testing.T) {
			if w := e.post(ep.path, ep.body(0)); w.Code != http.StatusBadRequest {
				t.Errorf("empty list: %d, want 400: %s", w.Code, w.Body)
			}
			if w := e.post(ep.path, fmt.Sprintf(`{"%s":[]}`, ep.key)); w.Code != http.StatusBadRequest {
				t.Errorf("explicit empty list: %d, want 400: %s", w.Code, w.Body)
			}
			if w := e.post(ep.path, ep.body(maxBulkItems+1)); w.Code != http.StatusBadRequest {
				t.Errorf("1001 entries: %d, want 400: %s", w.Code, w.Body)
			} else if !strings.Contains(w.Body.String(), "1000") {
				t.Errorf("cap message should name the limit: %s", w.Body)
			}
			if w := e.post(ep.path, `{not json`); w.Code != http.StatusBadRequest {
				t.Errorf("malformed body: %d, want 400: %s", w.Code, w.Body)
			}
			if w := e.post(ep.path, fmt.Sprintf(`{"%s":"nope"}`, ep.key)); w.Code != http.StatusBadRequest {
				t.Errorf("wrong list type: %d, want 400: %s", w.Code, w.Body)
			}
			if w := e.send(http.MethodPost, "/api"+ep.path, ep.body(1), false); w.Code != http.StatusForbidden {
				t.Errorf("no CSRF header: %d, want 403: %s", w.Code, w.Body)
			}
		})
	}
}

// Exactly 1000 entries is within the cap (the request is processed, not rejected).
func TestBulkEndpointsAcceptTheCap(t *testing.T) {
	e := newBkEnv(t)
	ids := make([]int64, maxBulkItems)
	for i := range ids {
		ids[i] = int64(i + 1)
	}
	w := e.post("/history/bulk-delete", bkJSON(t, map[string]any{"ids": ids}))
	e.want(w, http.StatusOK)
	if got := bkDecode[BulkDeleteResponse](t, w); got.Deleted != 0 {
		t.Fatalf("nothing existed, deleted = %d", got.Deleted)
	}
}

// --- downloads -------------------------------------------------------------

func TestBulkDeleteDownloads(t *testing.T) {
	e := newBkEnv(t)
	ctx := t.Context()

	t.Run("several ids, duplicates dropped, unknown ids ignored", func(t *testing.T) {
		a, b, c := e.download(models.StatusCompleted), e.download(models.StatusFailed), e.download(models.StatusCancelled)
		w := e.post("/downloads/bulk-delete", bkJSON(t, map[string]any{"ids": []int64{a, b, b, c, 99999}}))
		e.want(w, http.StatusOK)
		if got := bkDecode[BulkDeleteResponse](t, w); got.Deleted != 3 {
			t.Fatalf("deleted = %d, want 3 (the rows really removed)", got.Deleted)
		}
		for _, id := range []int64{a, b, c} {
			if _, err := e.downloads.Get(ctx, id); err == nil {
				t.Fatalf("download %d still exists", id)
			}
		}
	})

	t.Run("exactly one id", func(t *testing.T) {
		a := e.download(models.StatusCompleted)
		w := e.post("/downloads/bulk-delete", bkJSON(t, map[string]any{"ids": []int64{a}}))
		e.want(w, http.StatusOK)
		if got := bkDecode[BulkDeleteResponse](t, w); got.Deleted != 1 {
			t.Fatalf("deleted = %d", got.Deleted)
		}
	})

	t.Run("a only-unknown request is a success with zero", func(t *testing.T) {
		w := e.post("/downloads/bulk-delete", `{"ids":[424242]}`)
		e.want(w, http.StatusOK)
		if got := bkDecode[BulkDeleteResponse](t, w); got.Deleted != 0 {
			t.Fatalf("deleted = %d", got.Deleted)
		}
	})

	t.Run("an active download blocks everything", func(t *testing.T) {
		done := e.download(models.StatusCompleted)
		var active []int64
		for _, s := range models.ActiveStatuses() {
			active = append(active, e.download(s))
		}
		ids := append([]int64{done}, active...)
		w := e.post("/downloads/bulk-delete", bkJSON(t, map[string]any{"ids": ids}))
		e.want(w, http.StatusConflict)
		got := bkDecode[struct {
			Error      string  `json:"error"`
			BlockedIDs []int64 `json:"blockedIds"`
		}](t, w)
		if got.Error == "" || len(got.BlockedIDs) != len(active) {
			t.Fatalf("409 body = %+v, want every active id blocked", got)
		}
		for _, id := range ids {
			if _, err := e.downloads.Get(ctx, id); err != nil {
				t.Fatalf("download %d was deleted by a blocked request: %v", id, err)
			}
		}
	})
}

// --- history ---------------------------------------------------------------

func (e *bkEnv) historyRow(url, status string) int64 {
	e.t.Helper()
	id, err := e.history.Create(e.t.Context(), nil, url, status, nil)
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

func TestBulkDeleteHistory(t *testing.T) {
	e := newBkEnv(t)
	a, b, c := e.historyRow("https://e.test/a", "failed"), e.historyRow("https://e.test/b", "failed"), e.historyRow("https://e.test/c", "completed")

	w := e.post("/history/bulk-delete", bkJSON(t, map[string]any{"ids": []int64{a, b, b, 31337}}))
	e.want(w, http.StatusOK)
	if got := bkDecode[BulkDeleteResponse](t, w); got.Deleted != 2 {
		t.Fatalf("deleted = %d, want 2", got.Deleted)
	}
	if _, err := e.history.Get(t.Context(), c); err != nil {
		t.Fatalf("an unlisted entry was deleted: %v", err)
	}

	// One id.
	w = e.post("/history/bulk-delete", bkJSON(t, map[string]any{"ids": []int64{c}}))
	e.want(w, http.StatusOK)
	if got := bkDecode[BulkDeleteResponse](t, w); got.Deleted != 1 {
		t.Fatalf("deleted = %d, want 1", got.Deleted)
	}
}

func TestBulkRetryHistory(t *testing.T) {
	e := newBkEnv(t)
	ctx := t.Context()
	a := e.historyRow("https://e.test/a", "failed")
	b := e.historyRow("https://e.test/b", "cancelled")
	bad := e.historyRow("ftp://e.test/nope", "failed") // not http(s): enqueue refuses it

	w := e.post("/history/bulk-retry", bkJSON(t, map[string]any{"ids": []int64{a, 777777, bad, b, a}}))
	e.want(w, http.StatusOK)
	got := bkDecode[BulkResultsResponse[int64]](t, w)
	// Request order, duplicate dropped; a failing entry does not stop the rest.
	wantIDs := []int64{a, 777777, bad, b}
	if len(got.Results) != len(wantIDs) {
		t.Fatalf("results = %+v", got.Results)
	}
	for i, id := range wantIDs {
		if got.Results[i].ID != id {
			t.Fatalf("result %d is for %d, want %d (request order)", i, got.Results[i].ID, id)
		}
	}
	if got.Succeeded != 2 || got.Failed != 2 {
		t.Fatalf("succeeded/failed = %d/%d, want 2/2", got.Succeeded, got.Failed)
	}
	if r := got.Results[1]; r.OK || r.Status != http.StatusNotFound || r.Error == "" {
		t.Fatalf("unknown entry: %+v, want per-item 404", r)
	}
	if r := got.Results[2]; r.OK || r.Status != http.StatusBadRequest {
		t.Fatalf("bad URL entry: %+v, want per-item 400", r)
	}
	for _, i := range []int{0, 3} {
		r := got.Results[i]
		if !r.OK || r.DownloadID == nil {
			t.Fatalf("result %d = %+v, want ok with a download id", i, r)
		}
		d, err := e.downloads.Get(ctx, *r.DownloadID)
		if err != nil || d.Status != models.StatusQueued {
			t.Fatalf("new download %d: %+v %v", *r.DownloadID, d, err)
		}
	}

	t.Run("exactly one id", func(t *testing.T) {
		w := e.post("/history/bulk-retry", bkJSON(t, map[string]any{"ids": []int64{a}}))
		e.want(w, http.StatusOK)
		got := bkDecode[BulkResultsResponse[int64]](t, w)
		if got.Succeeded != 1 || got.Failed != 0 || got.Results[0].DownloadID == nil {
			t.Fatalf("%+v", got)
		}
	})
}

// --- subscriptions ----------------------------------------------------------

func (e *bkEnv) subscription(sourceIDs ...string) int64 {
	e.t.Helper()
	ctx := e.t.Context()
	id, err := e.subs.Create(ctx, &models.Subscription{URL: "https://example.test/c", Title: "t", MediaType: "video", CheckIntervalHours: 6, Enabled: true})
	if err != nil {
		e.t.Fatal(err)
	}
	for _, sid := range sourceIDs {
		if err := e.subs.RecordSeenEntry(ctx, id, sid, "title "+sid, "https://example.test/watch/"+sid, 10, nil); err != nil {
			e.t.Fatal(err)
		}
	}
	return id
}

func TestBulkDeleteSubscriptions(t *testing.T) {
	e := newBkEnv(t)
	a, b, keep := e.subscription("x"), e.subscription("y"), e.subscription("z")

	w := e.post("/subscriptions/bulk-delete", bkJSON(t, map[string]any{"ids": []int64{a, b, b, 98765}}))
	e.want(w, http.StatusOK)
	if got := bkDecode[BulkDeleteResponse](t, w); got.Deleted != 2 {
		t.Fatalf("deleted = %d, want 2", got.Deleted)
	}
	list, _ := e.subs.List(t.Context())
	if len(list) != 1 || list[0].ID != keep {
		t.Fatalf("remaining = %+v, want only %d", list, keep)
	}
	if n, _ := e.subs.CountSeenEntries(t.Context(), a); n != 0 {
		t.Fatalf("seen entries of a deleted subscription survived: %d", n)
	}

	w = e.post("/subscriptions/bulk-delete", bkJSON(t, map[string]any{"ids": []int64{keep}}))
	e.want(w, http.StatusOK)
	if got := bkDecode[BulkDeleteResponse](t, w); got.Deleted != 1 {
		t.Fatalf("single id: deleted = %d", got.Deleted)
	}

	// The Subscriptions feature gate stays on the route.
	if err := e.settings.Set(t.Context(), models.SettingFeatureSubscriptionsEnabled, "false"); err != nil {
		t.Fatal(err)
	}
	if w := e.post("/subscriptions/bulk-delete", `{"ids":[1]}`); w.Code == http.StatusOK {
		t.Fatalf("feature off: %d, want the feature gate's refusal", w.Code)
	}
}

func TestBulkSubscriptionEntrySeenAndUnlink(t *testing.T) {
	e := newBkEnv(t)
	ctx := t.Context()
	itemID := e.item("linked")
	sub := e.subscription("a", "b", "c")
	other := e.subscription("a") // same source id in another subscription must not be touched
	for _, sid := range []string{"a", "b"} {
		if err := e.subs.SetSeenEntryLibraryItemID(ctx, sub, sid, itemID); err != nil {
			t.Fatal(err)
		}
	}
	path := fmt.Sprintf("/subscriptions/%d/entries/", sub)

	t.Run("seen: several, unknown ignored, count is real", func(t *testing.T) {
		w := e.post(path+"bulk-seen", `{"sourceIds":["a","b","a","nope"]}`)
		e.want(w, http.StatusOK)
		if got := bkDecode[BulkUpdatedResponse](t, w); got.Updated != 2 {
			t.Fatalf("updated = %d, want 2", got.Updated)
		}
		if n, _ := e.subs.CountUnseenEntries(ctx, sub); n != 1 {
			t.Fatalf("unseen in sub = %d, want 1 (c)", n)
		}
		if n, _ := e.subs.CountUnseenEntries(ctx, other); n != 1 {
			t.Fatalf("another subscription's entry was marked: unseen = %d", n)
		}
	})
	t.Run("seen: exactly one", func(t *testing.T) {
		w := e.post(path+"bulk-seen", `{"sourceIds":["c"]}`)
		e.want(w, http.StatusOK)
		if got := bkDecode[BulkUpdatedResponse](t, w); got.Updated != 1 {
			t.Fatalf("updated = %d", got.Updated)
		}
	})
	t.Run("unlink: clears the link, not the item", func(t *testing.T) {
		w := e.post(path+"bulk-unlink", `{"sourceIds":["a","b","c","zzz"]}`)
		e.want(w, http.StatusOK)
		if got := bkDecode[BulkUpdatedResponse](t, w); got.Updated != 3 {
			t.Fatalf("updated = %d, want 3", got.Updated)
		}
		entry, err := e.subs.GetSeenEntry(ctx, sub, "a")
		if err != nil || entry.LibraryItemID != nil {
			t.Fatalf("entry a = %+v, %v; link should be cleared", entry, err)
		}
		if _, err := e.library.Get(ctx, itemID); err != nil {
			t.Fatalf("the library item must survive an unlink: %v", err)
		}
	})
	t.Run("the subscription must exist", func(t *testing.T) {
		for _, p := range []string{"bulk-seen", "bulk-unlink", "bulk-add"} {
			body := `{"sourceIds":["a"],"mode":"ghost"}`
			if w := e.post("/subscriptions/987654/entries/"+p, body); w.Code != http.StatusNotFound {
				t.Errorf("%s on a missing subscription: %d, want 404: %s", p, w.Code, w.Body)
			}
		}
	})
}

func TestBulkAddSubscriptionEntries(t *testing.T) {
	e := newBkEnv(t)
	ctx := t.Context()
	sub := e.subscription("a", "b")
	if err := e.subs.RecordSeenEntry(ctx, sub, "nourl", "no url", "", 0, nil); err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("/subscriptions/%d/entries/bulk-add", sub)

	t.Run("ghost mode: mix of success, missing entry and entry without a URL", func(t *testing.T) {
		w := e.post(path, `{"mode":"ghost","sourceIds":["a","ghostly","nourl","b","a"]}`)
		e.want(w, http.StatusOK)
		got := bkDecode[BulkResultsResponse[string]](t, w)
		order := []string{"a", "ghostly", "nourl", "b"}
		if len(got.Results) != len(order) {
			t.Fatalf("results = %+v", got.Results)
		}
		for i, sid := range order {
			if got.Results[i].ID != sid {
				t.Fatalf("result %d is %q, want %q", i, got.Results[i].ID, sid)
			}
		}
		if got.Succeeded != 2 || got.Failed != 2 {
			t.Fatalf("succeeded/failed = %d/%d", got.Succeeded, got.Failed)
		}
		if r := got.Results[1]; r.Status != http.StatusNotFound {
			t.Fatalf("missing entry: %+v", r)
		}
		if r := got.Results[2]; r.Status != http.StatusBadRequest {
			t.Fatalf("entry without URL: %+v", r)
		}
		for _, i := range []int{0, 3} {
			r := got.Results[i]
			if !r.OK || r.LibraryItemID == nil || r.DownloadID != nil {
				t.Fatalf("result %d = %+v, want ok with a library item id", i, r)
			}
			it, err := e.library.Get(ctx, *r.LibraryItemID)
			if err != nil || it.Status != "ghost" {
				t.Fatalf("ghost item %d: %+v %v", *r.LibraryItemID, it, err)
			}
		}
	})

	t.Run("download mode, exactly one id", func(t *testing.T) {
		w := e.post(path, `{"mode":"download","sourceIds":["a"]}`)
		e.want(w, http.StatusOK)
		got := bkDecode[BulkResultsResponse[string]](t, w)
		if got.Succeeded != 1 || got.Results[0].DownloadID == nil || got.Results[0].LibraryItemID != nil {
			t.Fatalf("%+v", got)
		}
		if _, err := e.downloads.Get(ctx, *got.Results[0].DownloadID); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("an unknown mode is a 400", func(t *testing.T) {
		if w := e.post(path, `{"mode":"bogus","sourceIds":["a"]}`); w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d: %s", w.Code, w.Body)
		}
		if w := e.post(path, `{"sourceIds":["a"]}`); w.Code != http.StatusBadRequest {
			t.Fatalf("missing mode: %d", w.Code)
		}
	})
}

// --- backup history ---------------------------------------------------------

func (e *bkEnv) backup(name string) (id int64, file string) {
	e.t.Helper()
	file = filepath.Join(e.backupsRoot, name)
	writeFile(e.t, file)
	size := int64(1)
	id, err := e.backups.Create(e.t.Context(), models.BackupHistory{TriggerType: "manual", Status: "success", FileName: &name, FileSizeBytes: &size})
	if err != nil {
		e.t.Fatal(err)
	}
	return id, file
}

func TestBulkDeleteBackupHistory(t *testing.T) {
	e := newBkEnv(t)
	a, fa := e.backup("a.zip")
	b, fb := e.backup("b.zip")
	c, fc := e.backup("c.zip")
	// A failed run has no file.
	msg := "boom"
	failed, err := e.backups.Create(t.Context(), models.BackupHistory{TriggerType: "manual", Status: "failed", ErrorMessage: &msg})
	if err != nil {
		t.Fatal(err)
	}

	w := e.post("/backup/history/bulk-delete", bkJSON(t, map[string]any{"ids": []int64{a, b, failed, a, 4242}}))
	e.want(w, http.StatusOK)
	if got := bkDecode[BulkDeleteResponse](t, w); got.Deleted != 3 {
		t.Fatalf("deleted = %d, want 3", got.Deleted)
	}
	for _, f := range []string{fa, fb} {
		if _, err := os.Stat(f); !os.IsNotExist(err) {
			t.Fatalf("%s should have been removed after the commit: %v", f, err)
		}
	}
	if _, err := os.Stat(fc); err != nil {
		t.Fatalf("an unlisted backup file was removed: %v", err)
	}

	// A row whose file is already gone still deletes (best-effort file removal).
	if err := os.Remove(fc); err != nil {
		t.Fatal(err)
	}
	w = e.post("/backup/history/bulk-delete", bkJSON(t, map[string]any{"ids": []int64{c}}))
	e.want(w, http.StatusOK)
	if got := bkDecode[BulkDeleteResponse](t, w); got.Deleted != 1 {
		t.Fatalf("single id: deleted = %d", got.Deleted)
	}
}

// A file name that would escape the backups folder is never followed.
func TestBulkDeleteBackupHistoryStaysInsideRoot(t *testing.T) {
	e := newBkEnv(t)
	outside := filepath.Join(t.TempDir(), "victim.txt")
	writeFile(t, outside)
	rel, err := filepath.Rel(e.backupsRoot, outside)
	if err != nil {
		t.Fatal(err)
	}
	id, err := e.backups.Create(t.Context(), models.BackupHistory{TriggerType: "manual", Status: "success", FileName: &rel})
	if err != nil {
		t.Fatal(err)
	}
	w := e.post("/backup/history/bulk-delete", bkJSON(t, map[string]any{"ids": []int64{id}}))
	e.want(w, http.StatusOK)
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("a file outside the backups root was deleted: %v", err)
	}
}

// --- thumbnail gallery ------------------------------------------------------

func (e *bkEnv) galleryImage(itemID int64, name string) (id int64, file string) {
	e.t.Helper()
	rel := filepath.ToSlash(filepath.Join("gallery", name))
	file = filepath.Join(e.imagesRoot, "gallery", name)
	writeFile(e.t, file)
	id, err := e.gallery.Create(e.t.Context(), itemID, rel, nil, nil, nil)
	if err != nil {
		e.t.Fatal(err)
	}
	return id, file
}

func TestBulkGalleryFavorite(t *testing.T) {
	e := newBkEnv(t)
	ctx := t.Context()
	item, other := e.item("one"), e.item("two")
	g1, _ := e.galleryImage(item, "1.jpg")
	g2, _ := e.galleryImage(item, "2.jpg")
	g3, _ := e.galleryImage(item, "3.jpg")
	foreign, _ := e.galleryImage(other, "x.jpg")
	path := fmt.Sprintf("/library/%d/thumbnail/gallery/bulk-favorite", item)
	fav := func(id int64) bool {
		img, err := e.gallery.Get(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		return img.IsFavorite
	}

	t.Run("several", func(t *testing.T) {
		w := e.post(path, bkJSON(t, map[string]any{"galleryIds": []int64{g1, g2, g2}, "isFavorite": true}))
		e.want(w, http.StatusOK)
		if got := bkDecode[BulkUpdatedResponse](t, w); got.Updated != 2 {
			t.Fatalf("updated = %d, want 2", got.Updated)
		}
		if !fav(g1) || !fav(g2) || fav(g3) {
			t.Fatal("wrong favorites after a bulk set")
		}
	})
	t.Run("exactly one, and unset", func(t *testing.T) {
		w := e.post(path, bkJSON(t, map[string]any{"galleryIds": []int64{g1}, "isFavorite": false}))
		e.want(w, http.StatusOK)
		if got := bkDecode[BulkUpdatedResponse](t, w); got.Updated != 1 || fav(g1) {
			t.Fatalf("updated = %d, g1 favorite = %v", got.Updated, fav(g1))
		}
	})
	t.Run("an id of another item fails the whole request", func(t *testing.T) {
		w := e.post(path, bkJSON(t, map[string]any{"galleryIds": []int64{g3, foreign}, "isFavorite": true}))
		e.want(w, http.StatusBadRequest)
		got := bkDecode[struct {
			InvalidIDs []int64 `json:"invalidIds"`
		}](t, w)
		if len(got.InvalidIDs) != 1 || got.InvalidIDs[0] != foreign {
			t.Fatalf("invalidIds = %v, want [%d]", got.InvalidIDs, foreign)
		}
		if fav(g3) || fav(foreign) {
			t.Fatal("a rejected request changed rows")
		}
	})
	t.Run("an id that does not exist is a 400 for favorite", func(t *testing.T) {
		w := e.post(path, bkJSON(t, map[string]any{"galleryIds": []int64{g3, 555555}, "isFavorite": true}))
		e.want(w, http.StatusBadRequest)
		if fav(g3) {
			t.Fatal("a rejected request changed rows")
		}
	})
	t.Run("an item with an active download is refused for the whole request", func(t *testing.T) {
		busy := e.item("busy")
		bg, _ := e.galleryImage(busy, "b.jpg")
		dl := e.download(models.StatusDownloading)
		if _, err := e.conn.ExecContext(ctx, `UPDATE downloads SET target_library_item_id = ? WHERE id = ?`, busy, dl); err != nil {
			t.Fatal(err)
		}
		w := e.post(fmt.Sprintf("/library/%d/thumbnail/gallery/bulk-favorite", busy), bkJSON(t, map[string]any{"galleryIds": []int64{bg}, "isFavorite": true}))
		e.want(w, http.StatusConflict)
		if fav(bg) {
			t.Fatal("changed while downloading")
		}
	})
}

func TestBulkDeleteGalleryImages(t *testing.T) {
	e := newBkEnv(t)
	ctx := t.Context()
	item, other := e.item("one"), e.item("two")
	g1, f1 := e.galleryImage(item, "1.jpg")
	g2, f2 := e.galleryImage(item, "2.jpg")
	g3, f3 := e.galleryImage(item, "3.jpg")
	foreign, ff := e.galleryImage(other, "x.jpg")
	path := fmt.Sprintf("/library/%d/thumbnail/gallery/bulk-delete", item)

	t.Run("a foreign id fails the whole request and removes nothing", func(t *testing.T) {
		w := e.post(path, bkJSON(t, map[string]any{"galleryIds": []int64{g1, foreign}}))
		e.want(w, http.StatusBadRequest)
		got := bkDecode[struct {
			InvalidIDs []int64 `json:"invalidIds"`
		}](t, w)
		if len(got.InvalidIDs) != 1 || got.InvalidIDs[0] != foreign {
			t.Fatalf("invalidIds = %v", got.InvalidIDs)
		}
		for _, f := range []string{f1, ff} {
			if _, err := os.Stat(f); err != nil {
				t.Fatalf("file %s removed by a rejected request", f)
			}
		}
		if _, err := e.gallery.Get(ctx, g1); err != nil {
			t.Fatalf("row removed by a rejected request: %v", err)
		}
	})
	t.Run("several; unknown ids are ignored; files go after the commit", func(t *testing.T) {
		w := e.post(path, bkJSON(t, map[string]any{"galleryIds": []int64{g1, g2, g2, 909090}}))
		e.want(w, http.StatusOK)
		if got := bkDecode[BulkDeleteResponse](t, w); got.Deleted != 2 {
			t.Fatalf("deleted = %d, want 2", got.Deleted)
		}
		for _, f := range []string{f1, f2} {
			if _, err := os.Stat(f); !os.IsNotExist(err) {
				t.Fatalf("file %s still there", f)
			}
		}
		if _, err := os.Stat(f3); err != nil {
			t.Fatal("an unlisted image file was removed")
		}
	})
	t.Run("exactly one, file already missing", func(t *testing.T) {
		if err := os.Remove(f3); err != nil {
			t.Fatal(err)
		}
		w := e.post(path, bkJSON(t, map[string]any{"galleryIds": []int64{g3}}))
		e.want(w, http.StatusOK)
		if got := bkDecode[BulkDeleteResponse](t, w); got.Deleted != 1 {
			t.Fatalf("deleted = %d", got.Deleted)
		}
	})
	t.Run("an item with an active download is refused", func(t *testing.T) {
		busy := e.item("busy")
		bg, bf := e.galleryImage(busy, "b.jpg")
		dl := e.download(models.StatusQueued)
		if _, err := e.conn.ExecContext(ctx, `UPDATE downloads SET target_library_item_id = ? WHERE id = ?`, busy, dl); err != nil {
			t.Fatal(err)
		}
		w := e.post(fmt.Sprintf("/library/%d/thumbnail/gallery/bulk-delete", busy), bkJSON(t, map[string]any{"galleryIds": []int64{bg}}))
		e.want(w, http.StatusConflict)
		if _, err := os.Stat(bf); err != nil {
			t.Fatal("file removed while downloading")
		}
		if _, err := e.gallery.Get(ctx, bg); err != nil {
			t.Fatal("row removed while downloading")
		}
	})
}

// Files are removed only AFTER the commit: when the transaction fails, rows and
// files are both still there.
func TestBulkDeleteKeepsFilesWhenTheTransactionFails(t *testing.T) {
	e := newBkEnv(t)
	ctx := t.Context()

	item := e.item("one")
	gid, gfile := e.galleryImage(item, "1.jpg")
	bid, bfile := e.backup("keep.zip")
	for _, trigger := range []string{
		fmt.Sprintf(`CREATE TRIGGER fail_g BEFORE DELETE ON thumbnail_gallery WHEN OLD.id = %d BEGIN SELECT RAISE(ABORT, 'injected'); END`, gid),
		fmt.Sprintf(`CREATE TRIGGER fail_b BEFORE DELETE ON backup_history WHEN OLD.id = %d BEGIN SELECT RAISE(ABORT, 'injected'); END`, bid),
	} {
		if _, err := e.conn.ExecContext(ctx, trigger); err != nil {
			t.Fatal(err)
		}
	}

	w := e.post(fmt.Sprintf("/library/%d/thumbnail/gallery/bulk-delete", item), bkJSON(t, map[string]any{"galleryIds": []int64{gid}}))
	e.want(w, http.StatusInternalServerError)
	w = e.post("/backup/history/bulk-delete", bkJSON(t, map[string]any{"ids": []int64{bid}}))
	e.want(w, http.StatusInternalServerError)

	for _, f := range []string{gfile, bfile} {
		if _, err := os.Stat(f); err != nil {
			t.Fatalf("%s was removed although the transaction failed", f)
		}
	}
	if _, err := e.gallery.Get(ctx, gid); err != nil {
		t.Fatal("gallery row gone")
	}
	if _, err := e.backups.Get(ctx, bid); err != nil {
		t.Fatal("backup row gone")
	}
}

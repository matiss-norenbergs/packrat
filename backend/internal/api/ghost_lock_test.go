package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/itemlock"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// guardedItemRoutes is every :id route that changes an item or its
// files and must answer 409 while the item has an active download. Keep in
// sync with router.go (TestRouterGuardsMutatingItemRoutes checks the wiring).
var guardedItemRoutes = []struct{ method, path string }{
	{"DELETE", "/library/:id/file"},
	{"POST", "/library/:id/move"},
	{"POST", "/library/:id/refresh-metadata"},
	{"POST", "/library/:id/trim/accept"},
	{"POST", "/library/:id/thumbnail"},
	{"DELETE", "/library/:id/thumbnail"},
	{"POST", "/library/:id/thumbnail/redownload"},
	{"POST", "/library/:id/thumbnail/quick-grab"},
	{"POST", "/library/:id/thumbnail/gallery"},
	{"POST", "/library/:id/thumbnail/gallery/:galleryId/apply"},
	{"POST", "/library/:id/thumbnail/gallery/bulk-favorite"},
	{"POST", "/library/:id/thumbnail/gallery/bulk-delete"},
	{"POST", "/library/:id/thumbnail/match"},
	{"POST", "/library/:id/nfo"},
	{"DELETE", "/library/:id/nfo"},
	{"POST", "/thumbnail-enhancement/items/:id/revert"},
	{"DELETE", "/thumbnail-enhancement/items/:id/original"},
}

func TestBlockWhenDownloadActiveMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := newCleanupEnv(t)
	busy, _ := e.ghostWithActiveDownload(t, models.StatusDownloading)
	idle, err := e.library.Create(context.Background(), &models.LibraryItem{Title: "idle", Status: "completed", Filename: "a.mp4", Path: "a.mp4"})
	if err != nil {
		t.Fatal(err)
	}

	r := gin.New()
	ok := func(c *gin.Context) { c.Status(http.StatusNoContent) }
	guard := blockWhenDownloadActive(e.downloads)
	for _, rt := range guardedItemRoutes {
		r.Handle(rt.method, rt.path, guard, ok)
	}
	// Left unguarded on purpose: read-only GETs, playback progress, delete.
	r.GET("/library/:id", ok)
	r.POST("/library/:id/progress", ok)
	r.DELETE("/library/:id", ok)

	fill := func(path string, id int64) string {
		return strings.ReplaceAll(strings.ReplaceAll(path, ":id", fmt.Sprint(id)), ":galleryId", "5")
	}
	do := func(method, path string) int {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(method, path, nil))
		return w.Code
	}
	for _, rt := range guardedItemRoutes {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			if got := do(rt.method, fill(rt.path, busy)); got != http.StatusConflict {
				t.Fatalf("active download: status %d, want 409", got)
			}
			if got := do(rt.method, fill(rt.path, idle)); got != http.StatusNoContent {
				t.Fatalf("no active download: status %d, want the handler's 204", got)
			}
		})
	}
	for _, rt := range []struct{ method, path string }{{"GET", "/library/:id"}, {"POST", "/library/:id/progress"}, {"DELETE", "/library/:id"}} {
		if got := do(rt.method, fill(rt.path, busy)); got != http.StatusNoContent {
			t.Fatalf("%s %s must stay allowed while downloading, got %d", rt.method, rt.path, got)
		}
	}
	// A malformed id is the handler's to reject, not the guard's.
	if got := do("POST", "/library/abc/move"); got != http.StatusNoContent {
		t.Fatalf("malformed id should fall through, got %d", got)
	}
}

// The middleware only protects routes it is actually attached to: scan router.go.
func TestRouterGuardsMutatingItemRoutes(t *testing.T) {
	src, err := os.ReadFile("router.go")
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(string(src), "\n")
	for _, rt := range guardedItemRoutes {
		prefix := fmt.Sprintf(`api.%s("%s",`, rt.method, rt.path)
		found := false
		for _, l := range lines {
			if strings.Contains(l, prefix) {
				found = true
				if !strings.Contains(l, "notDownloading") {
					t.Errorf("%s %s is not guarded by notDownloading", rt.method, rt.path)
				}
			}
		}
		if !found {
			t.Errorf("%s %s not found in router.go", rt.method, rt.path)
		}
	}
}

type bulkEnv struct {
	*cleanupEnv
	busyGhost, busyReal, free1, free2 int64
}

func newBulkEnv(t *testing.T) *bulkEnv {
	t.Helper()
	e := newCleanupEnv(t)
	ctx := context.Background()
	url := "https://example.test/v"
	thumb := "t.jpg"
	mk := func(title string, withThumb bool) int64 {
		it := &models.LibraryItem{Title: title, Status: "completed", Filename: title + ".mp4", Path: title + ".mp4", OriginalURL: &url}
		if withThumb {
			it.Thumbnail = &thumb
		}
		id, err := e.library.Create(ctx, it)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	b := &bulkEnv{cleanupEnv: e}
	b.busyGhost, _ = e.ghostWithActiveDownload(t, models.StatusDownloading)
	b.busyReal = mk("busyreal", true)
	if _, err := e.downloads.Create(ctx, &models.Download{URL: url, DownloadType: "video", Quality: "best", Status: models.StatusQueued, TargetLibraryItemID: &b.busyReal}); err != nil {
		t.Fatal(err)
	}
	b.free1, b.free2 = mk("free1", true), mk("free2", true)
	return b
}

func (b *bulkEnv) ids() string {
	return fmt.Sprintf(`[%d,%d,%d,%d]`, b.busyGhost, b.busyReal, b.free1, b.free2)
}

func decode[T any](t *testing.T, body []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("decoding %s: %v", body, err)
	}
	return v
}

func TestBulkTagsSkipsDownloadingItems(t *testing.T) {
	b := newBulkEnv(t)
	tags := repository.NewTagsRepo(b.conn)
	h := BulkAssignTags(b.library, tags, b.downloads, b.mediaRoot)
	w := b.do(t, h, http.MethodPost, "/library/bulk-tags", "/library/bulk-tags", fmt.Sprintf(`{"itemIds":%s,"tags":["x"]}`, b.ids()))
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	resp := decode[BulkAssignTagsResponse](t, w.Body.Bytes())
	if resp.Updated != 2 || resp.Skipped != 2 || resp.SkippedDownloading != 2 {
		t.Fatalf("resp = %+v", resp)
	}
	ctx := context.Background()
	for id, want := range map[int64]int{b.busyGhost: 0, b.busyReal: 0, b.free1: 1, b.free2: 1} {
		got, _ := tags.TagsForLibraryItem(ctx, id)
		if len(got) != want {
			t.Errorf("item %d has tags %v, want %d", id, got, want)
		}
	}
}

func TestBulkDeleteFilesSkipsDownloadingItems(t *testing.T) {
	b := newBulkEnv(t)
	h := BulkDeleteLibraryItemFiles(b.conn, b.library, b.downloads, b.originals, itemlock.New(), b.mediaRoot, b.imagesRoot)
	w := b.do(t, h, http.MethodPost, "/library/bulk-delete-file", "/library/bulk-delete-file", fmt.Sprintf(`{"itemIds":%s}`, b.ids()))
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	resp := decode[BulkDeleteLibraryItemFilesResponse](t, w.Body.Bytes())
	// The busy ghost has no file either way; the busy real item must be left intact.
	if resp.Deleted != 2 || resp.SkippedDownloading != 2 || resp.Skipped != 2 {
		t.Fatalf("resp = %+v", resp)
	}
	ctx := context.Background()
	if it, _ := b.library.Get(ctx, b.busyReal); it.Status != "completed" || it.Path == "" {
		t.Fatalf("a downloading item's file must not be detached: %+v", it)
	}
	if it, _ := b.library.Get(ctx, b.free1); it.Status != "ghost" {
		t.Fatalf("free item should have been processed: %+v", it)
	}
}

func TestBulkFetchThumbnailsSkipsDownloadingItems(t *testing.T) {
	b := newBulkEnv(t)
	// Free items carry no URL here so nothing reaches yt-dlp (nil): they count as ordinary skips.
	ctx := context.Background()
	for _, id := range []int64{b.free1, b.free2} {
		if err := b.library.UpdateOriginalURL(ctx, id, nil); err != nil {
			t.Fatal(err)
		}
	}
	h := BulkFetchLibraryThumbnails(b.library, b.downloads, b.imagesRoot, nil)
	w := b.do(t, h, http.MethodPost, "/library/bulk-fetch-thumbnails", "/library/bulk-fetch-thumbnails", fmt.Sprintf(`{"itemIds":%s}`, b.ids()))
	resp := decode[BulkFetchThumbnailsResponse](t, w.Body.Bytes())
	if w.Code != http.StatusOK || resp.Skipped != 4 || resp.SkippedDownloading != 2 || resp.Fetched != 0 {
		t.Fatalf("status %d resp = %+v", w.Code, resp)
	}
}

func TestBulkRedownloadSkipsDownloadingItems(t *testing.T) {
	b := newBulkEnv(t)
	ctx := context.Background()
	for _, id := range []int64{b.free1, b.free2} {
		if err := b.library.UpdateOriginalURL(ctx, id, nil); err != nil {
			t.Fatal(err)
		}
	}
	h := BulkRedownloadLibraryItems(b.library, b.downloads, b.mgr, nil, nil)
	w := b.do(t, h, http.MethodPost, "/library/bulk-redownload", "/library/bulk-redownload", fmt.Sprintf(`{"itemIds":%s}`, b.ids()))
	resp := decode[BulkRedownloadResponse](t, w.Body.Bytes())
	if w.Code != http.StatusOK || resp.Skipped != 4 || resp.SkippedDownloading != 2 || resp.Queued != 0 {
		t.Fatalf("status %d resp = %+v", w.Code, resp)
	}
}

func TestBulkFrameMatchSkipsDownloadingItems(t *testing.T) {
	b := newBulkEnv(t)
	h := BulkStartFrameMatch(b.library, b.queue, b.downloads)
	w := b.do(t, h, http.MethodPost, "/library/thumbnail/match/bulk", "/library/thumbnail/match/bulk", fmt.Sprintf(`{"itemIds":%s,"mode":"current"}`, b.ids()))
	resp := decode[BulkFrameMatchResponse](t, w.Body.Bytes())
	if w.Code != http.StatusAccepted || resp.Queued != 2 || resp.SkippedDownloading != 2 || resp.Skipped != 2 {
		t.Fatalf("status %d resp = %+v", w.Code, resp)
	}
}

func TestBulkDeleteStillCancelsDownloadingItems(t *testing.T) {
	b := newBulkEnv(t)
	h := BulkDeleteLibraryItems(b.conn, b.library, b.downloads, b.mgr, b.mediaRoot, b.imagesRoot)
	w := b.do(t, h, http.MethodPost, "/library/bulk-delete", "/library/bulk-delete", fmt.Sprintf(`{"itemIds":%s}`, b.ids()))
	resp := decode[BulkDeleteResponse](t, w.Body.Bytes())
	if w.Code != http.StatusOK || resp.Deleted != 4 {
		t.Fatalf("status %d resp = %+v", w.Code, resp)
	}
}

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/ws"
)

// ghostWithActiveDownload seeds a ghost library item with a download in the
// given status filling it in.
func (e *cleanupEnv) ghostWithActiveDownload(t *testing.T, status models.DownloadStatus) (itemID, downloadID int64) {
	t.Helper()
	ctx := context.Background()
	url := "https://example.test/v"
	itemID, err := e.library.Create(ctx, &models.LibraryItem{Title: "g", Status: "ghost", OriginalURL: &url})
	if err != nil {
		t.Fatal(err)
	}
	downloadID, err = e.downloads.Create(ctx, &models.Download{URL: url, DownloadType: "video", Quality: "best", Status: status, GhostLibraryItemID: &itemID})
	if err != nil {
		t.Fatal(err)
	}
	return itemID, downloadID
}

func TestRedownloadRejectedWhileDownloadActive(t *testing.T) {
	e := newCleanupEnv(t)
	itemID, dlID := e.ghostWithActiveDownload(t, models.StatusDownloading)

	routes := []struct {
		name, route, path, body string
		h                       gin.HandlerFunc
	}{
		{"redownload", "/library/:id/redownload", fmt.Sprintf("/library/%d/redownload", itemID), "",
			RedownloadLibraryItem(e.library, e.downloads, e.mgr, nil, nil)},
		{"from-url", "/library/:id/redownload/from-url", fmt.Sprintf("/library/%d/redownload/from-url", itemID), `{"url":"https://example.test/other","overwriteFields":["title"]}`,
			RedownloadLibraryItemFromURL(e.library, e.downloads, e.mgr, nil, nil)},
	}
	for _, r := range routes {
		t.Run(r.name, func(t *testing.T) {
			w := e.do(t, r.h, http.MethodPost, r.path, r.route, r.body)
			if w.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409: %s", w.Code, w.Body)
			}
		})
	}
	if got, _ := e.downloads.Get(context.Background(), dlID); got.Status != models.StatusDownloading {
		t.Fatalf("existing download was disturbed: %s", got.Status)
	}
	list, _ := e.downloads.List(context.Background())
	if len(list) != 1 {
		t.Fatalf("a rejected redownload must not enqueue anything, have %d downloads", len(list))
	}
}

func TestDeleteLibraryItemCancelsActiveDownload(t *testing.T) {
	t.Run("single", func(t *testing.T) {
		e := newCleanupEnv(t)
		itemID, dlID := e.ghostWithActiveDownload(t, models.StatusQueued)
		h := DeleteLibraryItem(e.library, e.downloads, e.mgr, e.mediaRoot, e.imagesRoot)
		w := e.do(t, h, http.MethodDelete, fmt.Sprintf("/library/%d", itemID), "/library/:id", "")
		if w.Code != http.StatusNoContent {
			t.Fatalf("status = %d: %s", w.Code, w.Body)
		}
		if e.itemExists(t, itemID) {
			t.Fatal("item still exists")
		}
		if d, _ := e.downloads.Get(context.Background(), dlID); d.Status != models.StatusCancelled {
			t.Fatalf("download status = %s, want cancelled", d.Status)
		}
	})
	t.Run("bulk", func(t *testing.T) {
		e := newCleanupEnv(t)
		itemID, dlID := e.ghostWithActiveDownload(t, models.StatusQueued)
		h := BulkDeleteLibraryItems(e.conn, e.library, e.downloads, e.mgr, e.mediaRoot, e.imagesRoot)
		w := e.do(t, h, http.MethodPost, "/library/bulk-delete", "/library/bulk-delete", fmt.Sprintf(`{"itemIds":[%d]}`, itemID))
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", w.Code, w.Body)
		}
		if e.itemExists(t, itemID) {
			t.Fatal("item still exists")
		}
		if d, _ := e.downloads.Get(context.Background(), dlID); d.Status != models.StatusCancelled {
			t.Fatalf("download status = %s, want cancelled", d.Status)
		}
	})
}

func TestItemResponsesExposeActiveDownloadID(t *testing.T) {
	f := newPrivacyFixture(t)
	ghost := f.item("ghosty", nil)
	idle := f.item("idle", nil)
	redown := f.item("redown", nil)
	dl, err := f.downloads.Create(f.ctx, &models.Download{URL: "https://e.test/a", DownloadType: "video", Quality: "best", Status: models.StatusDownloading, GhostLibraryItemID: &ghost})
	if err != nil {
		t.Fatal(err)
	}
	rd, err := f.downloads.Create(f.ctx, &models.Download{URL: "https://e.test/b", DownloadType: "video", Quality: "best", Status: models.StatusQueued, TargetLibraryItemID: &redown})
	if err != nil {
		t.Fatal(err)
	}
	// A finished one on the idle item must not count.
	if _, err := f.downloads.Create(f.ctx, &models.Download{URL: "https://e.test/c", DownloadType: "video", Quality: "best", Status: models.StatusFailed, GhostLibraryItemID: &idle}); err != nil {
		t.Fatal(err)
	}

	items := make([]models.LibraryItem, 0, 3)
	for _, id := range []int64{ghost, idle, redown} {
		it, err := f.library.Get(f.ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		items = append(items, *it)
	}
	resp, err := f.responder().Responses(f.ctx, items)
	if err != nil {
		t.Fatal(err)
	}
	if resp[0].ActiveDownloadID == nil || *resp[0].ActiveDownloadID != dl {
		t.Fatalf("ghost: %v want %d", resp[0].ActiveDownloadID, dl)
	}
	if resp[1].ActiveDownloadID != nil {
		t.Fatalf("idle: %v want nil", *resp[1].ActiveDownloadID)
	}
	if resp[2].ActiveDownloadID == nil || *resp[2].ActiveDownloadID != rd {
		t.Fatalf("redownload: %v want %d", resp[2].ActiveDownloadID, rd)
	}

	// Wire format: present as a number, and an explicit null when absent.
	b, _ := json.Marshal(resp[1])
	if !bytes.Contains(b, []byte(`"activeDownloadId":null`)) {
		t.Fatalf("expected activeDownloadId:null in %s", b)
	}
	b, _ = json.Marshal(resp[0])
	if !bytes.Contains(b, []byte(fmt.Sprintf(`"activeDownloadId":%d`, dl))) {
		t.Fatalf("expected activeDownloadId:%d in %s", dl, b)
	}
}

func TestRetryHistoryReusesGhost(t *testing.T) {
	e := newCleanupEnv(t)
	ctx := context.Background()
	history := newHistoryRepoFor(e)
	itemID, dlID := e.ghostWithActiveDownload(t, models.StatusFailed)
	histID, err := history.Create(ctx, &dlID, "https://example.test/v", "failed", nil)
	if err != nil {
		t.Fatal(err)
	}
	settings := newSettingsRepoFor(e)
	// Not started: the retry just needs to land in the queue.
	mgr := queue.NewDownloadManager(e.mediaRoot, e.imagesRoot, "", nil, e.downloads, e.library, newCollectionsRepoFor(e), history, nil, nil, settings, nil, nil, nil, queue.NewProgressStore(), ws.NoopBroadcaster{})
	h := BulkRetryHistory(history, e.downloads, e.library, mgr, newCollectionsRepoFor(e), settings)
	body := fmt.Sprintf(`{"ids":[%d]}`, histID)
	w := e.do(t, h, http.MethodPost, "/history/bulk-retry", "/history/bulk-retry", body)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	var out BulkResultsResponse[int64]
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Succeeded != 1 || out.Failed != 0 || out.Results[0].DownloadID == nil {
		t.Fatalf("first retry: %+v", out)
	}
	retry, err := e.downloads.Get(ctx, *out.Results[0].DownloadID)
	if err != nil {
		t.Fatal(err)
	}
	if retry.GhostLibraryItemID == nil || *retry.GhostLibraryItemID != itemID {
		t.Fatalf("retry should carry ghost %d, got %v", itemID, retry.GhostLibraryItemID)
	}

	// A second retry while the first is still queued is refused: HTTP 200, the
	// item itself reports 409.
	w = e.do(t, h, http.MethodPost, "/history/bulk-retry", "/history/bulk-retry", body)
	out = BulkResultsResponse[int64]{}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if w.Code != http.StatusOK || out.Failed != 1 || out.Results[0].Status != http.StatusConflict {
		t.Fatalf("second retry = %d %+v, want per-item 409", w.Code, out)
	}

	// A ghost that was deleted is simply not reused: the retry is a plain one.
	e2 := newCleanupEnv(t)
	item2, dl2 := e2.ghostWithActiveDownload(t, models.StatusFailed)
	history2 := newHistoryRepoFor(e2)
	hist2, _ := history2.Create(ctx, &dl2, "https://example.test/v", "failed", nil)
	if err := e2.library.Delete(ctx, item2); err != nil {
		t.Fatal(err)
	}
	mgr2 := queue.NewDownloadManager(e2.mediaRoot, e2.imagesRoot, "", nil, e2.downloads, e2.library, newCollectionsRepoFor(e2), history2, nil, nil, newSettingsRepoFor(e2), nil, nil, nil, queue.NewProgressStore(), ws.NoopBroadcaster{})
	h2 := BulkRetryHistory(history2, e2.downloads, e2.library, mgr2, newCollectionsRepoFor(e2), newSettingsRepoFor(e2))
	w = e2.do(t, h2, http.MethodPost, "/history/bulk-retry", "/history/bulk-retry", fmt.Sprintf(`{"ids":[%d]}`, hist2))
	out = BulkResultsResponse[int64]{}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if w.Code != http.StatusOK || out.Succeeded != 1 {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
}

func newHistoryRepoFor(e *cleanupEnv) *repository.HistoryRepo {
	return repository.NewHistoryRepo(e.conn)
}
func newSettingsRepoFor(e *cleanupEnv) *repository.SettingsRepo {
	return repository.NewSettingsRepo(e.conn)
}
func newCollectionsRepoFor(e *cleanupEnv) *repository.CollectionsRepo {
	return repository.NewCollectionsRepo(e.conn)
}

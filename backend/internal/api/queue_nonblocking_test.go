package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
)

// The bkEnv manager is never started, so no worker ever takes an id — the
// extreme of "every worker is busy". The old 100-slot channel made the 101st
// Enqueue of a bulk request block until a download finished; now a bulk request
// of any size queues instantly and every item succeeds.
const bulkQueueSize = 300

func (e *bkEnv) countDownloads(status models.DownloadStatus) int {
	e.t.Helper()
	rows, err := e.downloads.List(context.Background())
	if err != nil {
		e.t.Fatal(err)
	}
	n := 0
	for _, d := range rows {
		if d.Status == status {
			n++
		}
	}
	return n
}

// postWithin fails the test if the request does not answer in time (a blocked
// Enqueue would hang the handler forever).
func (e *bkEnv) postWithin(limit time.Duration, path, body string) (code int, raw string) {
	e.t.Helper()
	type res struct {
		code int
		body string
	}
	ch := make(chan res, 1)
	go func() {
		w := e.post(path, body)
		ch <- res{w.Code, w.Body.String()}
	}()
	select {
	case r := <-ch:
		return r.code, r.body
	case <-time.After(limit):
		e.t.Fatalf("POST /api%s did not answer within %v (Enqueue blocked?)", path, limit)
		return 0, ""
	}
}

func TestBulkRetryHistoryQueuesHundredsInstantly(t *testing.T) {
	e := newBkEnv(t)
	ids := make([]int64, bulkQueueSize)
	for i := range ids {
		ids[i] = e.historyRow(fmt.Sprintf("https://e.test/v/%d", i), "failed")
	}

	start := time.Now()
	code, raw := e.postWithin(20*time.Second, "/history/bulk-retry", bkJSON(t, map[string]any{"ids": ids}))
	took := time.Since(start)
	if code != http.StatusOK {
		t.Fatalf("status = %d: %.300s", code, raw)
	}
	if took > 5*time.Second {
		t.Fatalf("bulk retry of %d took %v", bulkQueueSize, took)
	}
	var got BulkResultsResponse[int64]
	decodeInto(t, raw, &got)
	if got.Succeeded != bulkQueueSize || got.Failed != 0 {
		t.Fatalf("succeeded/failed = %d/%d, want %d/0", got.Succeeded, got.Failed, bulkQueueSize)
	}
	if n := e.countDownloads(models.StatusQueued); n != bulkQueueSize {
		t.Fatalf("%d queued downloads, want %d", n, bulkQueueSize)
	}
}

func TestBulkAddSubscriptionEntriesQueuesHundredsInstantly(t *testing.T) {
	e := newBkEnv(t)
	sourceIDs := make([]string, bulkQueueSize)
	for i := range sourceIDs {
		sourceIDs[i] = fmt.Sprintf("s%d", i)
	}
	sub := e.subscription(sourceIDs...)

	start := time.Now()
	code, raw := e.postWithin(20*time.Second, fmt.Sprintf("/subscriptions/%d/entries/bulk-add", sub),
		bkJSON(t, map[string]any{"mode": "download", "sourceIds": sourceIDs}))
	took := time.Since(start)
	if code != http.StatusOK {
		t.Fatalf("status = %d: %.300s", code, raw)
	}
	if took > 5*time.Second {
		t.Fatalf("bulk add of %d took %v", bulkQueueSize, took)
	}
	var got BulkResultsResponse[string]
	decodeInto(t, raw, &got)
	if got.Succeeded != bulkQueueSize || got.Failed != 0 {
		t.Fatalf("succeeded/failed = %d/%d, want %d/0", got.Succeeded, got.Failed, bulkQueueSize)
	}
	if n := e.countDownloads(models.StatusQueued); n != bulkQueueSize {
		t.Fatalf("%d queued downloads, want %d", n, bulkQueueSize)
	}
}

// While the server shuts down, every enqueue path answers 503 and creates no
// row; the bulk endpoints report it per item.
func TestEnqueueDuringShutdownIs503(t *testing.T) {
	e := newBkEnv(t)
	hist := []int64{e.historyRow("https://e.test/a", "failed"), e.historyRow("https://e.test/b", "failed")}
	sub := e.subscription("a", "b")

	ctx, cancel := context.WithCancel(context.Background())
	e.mgr.Start(ctx, 0) // no workers: only the root context matters here
	cancel()            // the process is shutting down

	t.Run("single download", func(t *testing.T) {
		w := e.post("/downloads", `{"url":"https://e.test/x","downloadType":"video","quality":"best"}`)
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want 503: %s", w.Code, w.Body)
		}
	})
	t.Run("batch reports it per item", func(t *testing.T) {
		w := e.post("/downloads/batch", `{"items":[{"url":"https://e.test/y","downloadType":"video","quality":"best"}]}`)
		e.want(w, http.StatusCreated) // the batch answer is 201 with a per-item failed list
		var got EnqueueResultResponse
		decodeInto(t, w.Body.String(), &got)
		if len(got.Queued) != 0 || len(got.Failed) != 1 || got.Failed[0].Error != queue.ErrShuttingDown.Error() {
			t.Fatalf("%+v", got)
		}
	})
	t.Run("bulk retry", func(t *testing.T) {
		w := e.post("/history/bulk-retry", bkJSON(t, map[string]any{"ids": hist}))
		e.want(w, http.StatusOK)
		got := bkDecode[BulkResultsResponse[int64]](t, w)
		if got.Succeeded != 0 || got.Failed != 2 {
			t.Fatalf("%+v", got)
		}
		for _, r := range got.Results {
			if r.OK || r.Status != http.StatusServiceUnavailable {
				t.Fatalf("result %+v, want per-item 503", r)
			}
		}
	})
	t.Run("bulk add entries", func(t *testing.T) {
		w := e.post(fmt.Sprintf("/subscriptions/%d/entries/bulk-add", sub), `{"mode":"download","sourceIds":["a","b"]}`)
		e.want(w, http.StatusOK)
		got := bkDecode[BulkResultsResponse[string]](t, w)
		if got.Succeeded != 0 || got.Failed != 2 {
			t.Fatalf("%+v", got)
		}
		for _, r := range got.Results {
			if r.OK || r.Status != http.StatusServiceUnavailable {
				t.Fatalf("result %+v, want per-item 503", r)
			}
		}
	})
	if n := e.countDownloads(models.StatusQueued); n != 0 {
		t.Fatalf("%d download rows created during shutdown, want none", n)
	}
}

func decodeInto(t *testing.T, raw string, v any) {
	t.Helper()
	if err := json.Unmarshal([]byte(raw), v); err != nil {
		t.Fatalf("decoding %.300q: %v", raw, err)
	}
}

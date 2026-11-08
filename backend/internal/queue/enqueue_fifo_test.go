package queue

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sort"
	"testing"
	"time"

	"packrat/backend/internal/bgtasks"
	"packrat/backend/internal/models"
	"packrat/backend/internal/ws"
)

// lastQueued is the Queued number of the most recent queue_update broadcast,
// i.e. what the Downloads page shows.
func (b *recordingBroadcaster) lastQueued() (queued int, seen bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for i := len(b.events) - 1; i >= 0; i-- {
		if b.events[i].Type == ws.EventQueueUpdate {
			return b.events[i].Payload.(ws.QueueUpdatePayload).Queued, true
		}
	}
	return 0, false
}

// startWorkers runs n real workers on the env's manager and stops them (and
// waits for them) before the database is closed.
func (e *ghostEnv) startWorkers(n int) {
	e.t.Helper()
	if runtime.GOOS == "windows" {
		e.t.Skip("needs the fake yt-dlp shell script")
	}
	tracker := &bgtasks.Tracker{}
	e.mgr.SetTracker(tracker)
	ctx, cancel := context.WithCancel(context.Background())
	e.mgr.Start(ctx, n)
	e.t.Cleanup(func() {
		cancel()
		tracker.Wait(10 * time.Second)
	})
}

// enqueueN enqueues n distinct downloads (distinct literal filenames so the
// runs never clash) and returns their ids in enqueue order.
func (e *ghostEnv) enqueueN(from, n int) []int64 {
	e.t.Helper()
	ids := make([]int64, 0, n)
	for i := from; i < from+n; i++ {
		id, err := e.mgr.Enqueue(context.Background(), models.Download{
			URL: fmt.Sprintf("https://example.test/watch?v=%d", i), DownloadType: "video", Quality: "best",
			Filename: fmt.Sprintf("clip-%d", i),
		})
		if err != nil {
			e.t.Fatalf("Enqueue #%d: %v", i, err)
		}
		ids = append(ids, id)
	}
	return ids
}

func (e *ghostEnv) countStatus(want models.DownloadStatus) int {
	e.t.Helper()
	rows, err := e.downloads.List(context.Background())
	if err != nil {
		e.t.Fatal(err)
	}
	n := 0
	for _, d := range rows {
		if d.Status == want {
			n++
		}
	}
	return n
}

// With nothing consuming, 500 enqueues must all return at once. The old
// 100-slot channel blocked the 101st call forever.
func TestEnqueueDoesNotBlockWithoutWorkers(t *testing.T) {
	e := newGhostEnv(t)

	start := time.Now()
	done := make(chan []int64, 1)
	go func() { done <- e.enqueueN(0, 500) }()
	var ids []int64
	select {
	case ids = <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("Enqueue blocked (queue capped?)")
	}
	if took := time.Since(start); took > 5*time.Second {
		t.Fatalf("500 enqueues took %v", took)
	}
	if len(ids) != 500 {
		t.Fatalf("got %d ids", len(ids))
	}
	if n := e.countStatus(models.StatusQueued); n != 500 {
		t.Fatalf("%d queued rows, want 500", n)
	}
	if q, seen := e.bc.lastQueued(); !seen || q != 500 {
		t.Fatalf("Queued count = %d (seen %v), want 500", q, seen)
	}
}

// One worker held by a long download: 499 more enqueues return promptly, every
// row exists as queued, the Queued count is 499, and once the worker is freed
// the rest run in enqueue order.
func TestEnqueueWithBusyWorkerStaysFIFO(t *testing.T) {
	e := newGhostEnv(t)
	e.flag("slow", true) // downloads hang until killed
	e.startWorkers(1)

	first := e.enqueueN(0, 1)[0]
	waitFor(t, "first download running", func() bool {
		return e.download(first).Status != models.StatusQueued
	})

	start := time.Now()
	done := make(chan []int64, 1)
	go func() { done <- e.enqueueN(1, 499) }()
	var rest []int64
	select {
	case rest = <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("Enqueue blocked behind the busy worker")
	}
	if took := time.Since(start); took > 3*time.Second {
		t.Fatalf("499 enqueues took %v, want well under a second of real work", took)
	}

	if n := e.countStatus(models.StatusQueued); n != 499 {
		t.Fatalf("%d rows still queued, want 499 (+1 running)", n)
	}
	if q, _ := e.bc.lastQueued(); q != 499 {
		t.Fatalf("Queued count = %d, want 499", q)
	}

	// Free the worker: the stuck first download is cancelled and the (now
	// fast) rest are picked up strictly in enqueue order.
	e.flag("slow", false)
	if err := e.mgr.Cancel(context.Background(), first); err != nil {
		t.Fatal(err)
	}
	const checked = 15
	waitFor(t, "first downloads completed", func() bool {
		for _, id := range rest[:checked] {
			if e.download(id).Status != models.StatusCompleted {
				return false
			}
		}
		return true
	})
	// Ghost rows are created as each run starts; with one worker their order
	// is the order the queue handed the ids out.
	byItem := map[int64]int64{} // library item id -> download id
	var itemIDs []int64
	for _, it := range e.items() {
		if it.DownloadID != nil {
			byItem[it.ID] = *it.DownloadID
			itemIDs = append(itemIDs, it.ID)
		}
	}
	sort.Slice(itemIDs, func(i, j int) bool { return itemIDs[i] < itemIDs[j] }) // creation order
	var order []int64
	for _, id := range itemIDs {
		order = append(order, byItem[id])
	}
	if len(order) < checked {
		t.Fatalf("only %d runs started: %v", len(order), order)
	}
	for i := 1; i < len(order); i++ {
		if order[i] < order[i-1] {
			t.Fatalf("downloads ran out of enqueue order: %v", order)
		}
	}

	// Drop the remainder so the test does not download all 500.
	for _, id := range rest {
		_ = e.mgr.Cancel(context.Background(), id)
	}
	waitFor(t, "queue drained", func() bool {
		q, _ := e.bc.lastQueued()
		return q == 0
	})
}

// Cancelling a queued download takes it out of the FIFO at once (the Queued
// count drops) and the worker never runs it.
func TestCancelQueuedRemovesFromFIFO(t *testing.T) {
	e := newGhostEnv(t)
	e.flag("slow", true)
	e.startWorkers(1)

	ids := e.enqueueN(0, 1)
	waitFor(t, "first download running", func() bool { return e.download(ids[0]).Status != models.StatusQueued })
	ids = append(ids, e.enqueueN(1, 3)...)
	if q, _ := e.bc.lastQueued(); q != 3 {
		t.Fatalf("Queued = %d, want 3", q)
	}

	if err := e.mgr.Cancel(context.Background(), ids[2]); err != nil {
		t.Fatal(err)
	}
	if got := e.download(ids[2]).Status; got != models.StatusCancelled {
		t.Fatalf("status = %q, want cancelled", got)
	}
	if q, _ := e.bc.lastQueued(); q != 2 {
		t.Fatalf("Queued after cancel = %d, want 2 (the id must leave the FIFO now)", q)
	}
	if e.mgr.jobs.Remove(ids[2]) {
		t.Fatal("cancelled id is still in the FIFO")
	}

	// Free the worker; ids[1] and ids[3] run, ids[2] must never start.
	e.flag("slow", false)
	if err := e.mgr.Cancel(context.Background(), ids[0]); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "remaining downloads completed", func() bool {
		return e.download(ids[1]).Status == models.StatusCompleted && e.download(ids[3]).Status == models.StatusCompleted
	})
	if got := e.download(ids[2]).Status; got != models.StatusCancelled {
		t.Fatalf("cancelled download ended %q", got)
	}
	for _, it := range e.items() {
		if it.DownloadID != nil && *it.DownloadID == ids[2] {
			t.Fatalf("cancelled download produced library item %+v", it)
		}
	}
}

// Shrinking the pool with items queued leaves them queued for the workers that
// remain; they are not lost or run by a retired worker.
func TestShrinkingPoolKeepsQueuedItems(t *testing.T) {
	e := newGhostEnv(t)
	e.flag("slow", true)
	e.startWorkers(2)

	ids := e.enqueueN(0, 6)
	waitFor(t, "two running", func() bool { return e.countStatus(models.StatusQueued) == 4 })

	e.mgr.SetWorkerCount(1)
	time.Sleep(50 * time.Millisecond)
	if n := e.countStatus(models.StatusQueued); n != 4 {
		t.Fatalf("%d queued after shrink, want 4", n)
	}

	// Free everything; the single remaining worker (plus the in-flight run of
	// the retired one, which finishes on its own) drains the queue.
	e.flag("slow", false)
	_ = e.mgr.Cancel(context.Background(), ids[0])
	_ = e.mgr.Cancel(context.Background(), ids[1])
	waitFor(t, "queue drained", func() bool { return e.countStatus(models.StatusQueued) == 0 })
	for _, id := range ids[2:] {
		waitFor(t, "download completed", func() bool { return e.download(id).Status == models.StatusCompleted })
	}
}

// Once the root context is cancelled Enqueue refuses, creates no row and
// returns at once.
func TestEnqueueAfterShutdownReturnsErrShuttingDown(t *testing.T) {
	e := newGhostEnv(t)
	ctx, cancel := context.WithCancel(context.Background())
	e.mgr.rootCtx = ctx

	if _, err := e.mgr.Enqueue(context.Background(), models.Download{URL: "https://example.test/a", DownloadType: "video", Quality: "best"}); err != nil {
		t.Fatalf("Enqueue before shutdown: %v", err)
	}
	cancel()

	done := make(chan error, 1)
	go func() {
		_, err := e.mgr.Enqueue(context.Background(), models.Download{URL: "https://example.test/b", DownloadType: "video", Quality: "best"})
		done <- err
	}()
	select {
	case err := <-done:
		if !errors.Is(err, ErrShuttingDown) {
			t.Fatalf("err = %v, want ErrShuttingDown", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Enqueue blocked during shutdown")
	}
	rows, err := e.downloads.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("%d download rows, want only the one created before shutdown", len(rows))
	}
}

// A manager that was never started (tests, the API fixtures) has no root
// context and must not read as shutting down, so Enqueue keeps working there.
func TestNotShuttingDownBeforeStart(t *testing.T) {
	m := NewDownloadManager("", "", "", nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, NewProgressStore(), ws.NoopBroadcaster{})
	if m.shuttingDown() {
		t.Fatal("a manager that was never started reports shutting down")
	}
}

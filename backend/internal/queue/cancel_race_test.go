package queue

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"packrat/backend/internal/models"
)

// ytdlpCalls is how many times the fake yt-dlp was started (metadata or download).
func (e *ghostEnv) ytdlpCalls() int {
	e.t.Helper()
	raw, err := os.ReadFile(filepath.Join(e.binDir, "calls.log"))
	if os.IsNotExist(err) {
		return 0
	}
	if err != nil {
		e.t.Fatal(err)
	}
	n := 0
	for _, b := range raw {
		if b == '\n' {
			n++
		}
	}
	return n
}

// S4-7, interleaving 1: Cancel lands after the worker loaded the (still queued)
// row but before it registered its cancel func. Cancel finds nothing running and
// marks the row cancelled; the worker's conditional start then changes 0 rows and
// must skip the run. (The old unconditional UpdateStatus overwrote the cancel
// with fetching_metadata and downloaded anyway.)
func TestCancelBetweenLoadAndRegisterNeverStarts(t *testing.T) {
	e := newGhostEnv(t)
	id := e.newDownload(models.Download{})

	var cancelErr error
	e.mgr.hookAfterLoad = func(got int64) {
		if got == id {
			cancelErr = e.mgr.Cancel(context.Background(), id)
		}
	}
	e.mgr.runOne(context.Background(), id)

	if cancelErr != nil {
		t.Fatalf("Cancel: %v", cancelErr)
	}
	if n := e.ytdlpCalls(); n != 0 {
		t.Fatalf("yt-dlp was started %d times for a cancelled download", n)
	}
	if got := e.download(id).Status; got != models.StatusCancelled {
		t.Fatalf("status = %q, want cancelled", got)
	}
	if h := e.historyStatuses(id); len(h) != 0 {
		t.Fatalf("history rows %v written for a download that never ran", h)
	}
	if items := e.items(); len(items) != 0 {
		t.Fatalf("library items created for a cancelled download: %+v", items)
	}
	e.assertWorkerIdle()
}

// S4-7, interleaving 2: Cancel lands after the cancel func is registered. It takes
// the running branch (cancels the run context); the worker must not start yt-dlp
// and the download ends cancelled, with the usual cancelled history entry.
func TestCancelAfterRegisterNeverStarts(t *testing.T) {
	e := newGhostEnv(t)
	id := e.newDownload(models.Download{})

	var cancelErr error
	e.mgr.hookAfterRegister = func(got int64) {
		if got == id {
			cancelErr = e.mgr.Cancel(context.Background(), id)
		}
	}
	e.mgr.runOne(context.Background(), id)

	if cancelErr != nil {
		t.Fatalf("Cancel: %v", cancelErr)
	}
	if n := e.ytdlpCalls(); n != 0 {
		t.Fatalf("yt-dlp was started %d times for a cancelled download", n)
	}
	if got := e.download(id).Status; got != models.StatusCancelled {
		t.Fatalf("status = %q, want cancelled", got)
	}
	for _, h := range e.historyStatuses(id) {
		if h != "cancelled" {
			t.Fatalf("history has %q, want only cancelled", h)
		}
	}
	if items := e.items(); len(items) != 0 {
		t.Fatalf("library items created for a cancelled download: %+v", items)
	}
	e.assertWorkerIdle()
}

// Both hooks installed but no Cancel: a normal download still runs to completion.
func TestNormalDownloadStillRunsThroughTheConditionalStart(t *testing.T) {
	e := newGhostEnv(t)
	id := e.newDownload(models.Download{})
	loaded, registered := 0, 0
	e.mgr.hookAfterLoad = func(int64) { loaded++ }
	e.mgr.hookAfterRegister = func(int64) { registered++ }

	e.mgr.runOne(context.Background(), id)

	if loaded != 1 || registered != 1 {
		t.Fatalf("hooks ran %d/%d times, want 1/1", loaded, registered)
	}
	if got := e.download(id).Status; got != models.StatusCompleted {
		t.Fatalf("status = %q, want completed", got)
	}
	if n := e.ytdlpCalls(); n == 0 {
		t.Fatal("yt-dlp never ran")
	}
	if items := e.items(); len(items) != 1 || items[0].Status != "completed" {
		t.Fatalf("library = %+v, want one completed item", items)
	}
	e.assertWorkerIdle()
}

// A redownload row is queued like any other and goes through the same conditional
// start: cancelled between load and start, it never runs and leaves the library
// item alone.
func TestCancelledRedownloadNeverStarts(t *testing.T) {
	e := newGhostEnv(t)
	itemID, err := e.library.Create(context.Background(), &models.LibraryItem{Title: "Existing", Filename: "x.mp4", Path: "x.mp4", Status: "completed"})
	if err != nil {
		t.Fatal(err)
	}
	id := e.newDownload(models.Download{TargetLibraryItemID: &itemID})
	e.mgr.hookAfterLoad = func(got int64) { _ = e.mgr.Cancel(context.Background(), got) }

	e.mgr.runOne(context.Background(), id)

	if n := e.ytdlpCalls(); n != 0 {
		t.Fatalf("yt-dlp was started %d times", n)
	}
	if got := e.download(id).Status; got != models.StatusCancelled {
		t.Fatalf("status = %q, want cancelled", got)
	}
	it, err := e.library.Get(context.Background(), itemID)
	if err != nil || it.Status != "completed" || it.Filename != "x.mp4" {
		t.Fatalf("existing item touched: %+v %v", it, err)
	}
}

// Cancel of a download that already moved past cancellable (no worker cancel func
// registered, e.g. just finished) reports "not cancellable" and changes nothing.
func TestCancelOfFinishedDownloadIsRefused(t *testing.T) {
	e := newGhostEnv(t)
	id := e.newDownload(models.Download{})
	e.mgr.runOne(context.Background(), id)
	if got := e.download(id).Status; got != models.StatusCompleted {
		t.Fatalf("setup: status = %q", got)
	}
	if err := e.mgr.Cancel(context.Background(), id); err == nil {
		t.Fatal("Cancel of a completed download succeeded")
	}
	if got := e.download(id).Status; got != models.StatusCompleted {
		t.Fatalf("status = %q after refused cancel", got)
	}
}

// After a skipped or finished run nothing stays registered or counted active.
func (e *ghostEnv) assertWorkerIdle() {
	e.t.Helper()
	e.mgr.mu.Lock()
	n := len(e.mgr.cancels)
	e.mgr.mu.Unlock()
	if n != 0 {
		e.t.Fatalf("%d cancel funcs left registered", n)
	}
	if e.mgr.HasActive() {
		e.t.Fatal("manager still reports an active download")
	}
}

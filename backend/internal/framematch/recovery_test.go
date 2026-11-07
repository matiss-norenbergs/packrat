package framematch

import (
	"context"
	"testing"

	"packrat/backend/internal/models"
)

// Startup recovery turns "running" rows into error rows (never back into "queued", which could
// crash-loop on a file that kills the process), leaves queued/done rows alone, and the item can be
// queued again once the error row is discarded.
func TestResetInterruptedMarksRunningAsError(t *testing.T) {
	lib, qr := newQueueTestRepos(t)
	ctx := context.Background()

	mk := func(name string) (itemID, queueID int64) {
		id, err := lib.Create(ctx, &models.LibraryItem{Title: name, Filename: name + ".mp4", Path: name + ".mp4", Status: "completed"})
		if err != nil {
			t.Fatal(err)
		}
		q, err := qr.Create(ctx, id, name, "current")
		if err != nil {
			t.Fatal(err)
		}
		return id, q
	}
	runItem, running := mk("running")
	_, queued := mk("queued")
	_, done := mk("done")
	if err := qr.SetRunning(ctx, running); err != nil {
		t.Fatal(err)
	}
	if err := qr.SetDone(ctx, done, 1.5, 0.9, "f.jpg", "r.jpg"); err != nil {
		t.Fatal(err)
	}

	n, err := ResetInterrupted(ctx, qr)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("reset %d rows, want 1", n)
	}

	got, _ := qr.Get(ctx, running)
	if got.State != "error" || got.ErrorMsg == nil || *got.ErrorMsg != InterruptedMessage {
		t.Fatalf("running row: state %q err %v", got.State, got.ErrorMsg)
	}
	if q, _ := qr.Get(ctx, queued); q.State != "queued" || q.ErrorMsg != nil {
		t.Fatalf("queued row touched: %+v", q)
	}
	if d, _ := qr.Get(ctx, done); d.State != "done" || d.ErrorMsg != nil {
		t.Fatalf("done row touched: %+v", d)
	}
	if next, _ := qr.NextQueued(ctx); next == nil || next.ID != queued {
		t.Fatalf("NextQueued = %+v, want the queued row", next)
	}

	// The error row still occupies the item until it is discarded in the UI; after that the item can
	// be enqueued again.
	if exists, _ := qr.ExistsForLibraryItem(ctx, runItem); !exists {
		t.Fatal("error row should still be listed so the user sees the message")
	}
	if err := qr.Delete(ctx, running); err != nil {
		t.Fatal(err)
	}
	if exists, _ := qr.ExistsForLibraryItem(ctx, runItem); exists {
		t.Fatal("item still blocked after the error row was discarded")
	}
	if _, err := qr.Create(ctx, runItem, "running", "current"); err != nil {
		t.Fatalf("re-enqueue failed: %v", err)
	}

	// Idempotent: a second pass finds nothing running.
	if n, _ := ResetInterrupted(ctx, qr); n != 0 {
		t.Fatalf("second reset changed %d rows", n)
	}
}

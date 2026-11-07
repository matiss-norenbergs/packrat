package queue

import (
	"context"
	"testing"

	"packrat/backend/internal/models"
)

// A genuine failure that is reported while the server is shutting down (the root context already
// cancelled) must still be written: the row ends up failed with its message and history entry.
func TestFinishErrorRecordsFailureAfterRootCancelled(t *testing.T) {
	e := newGhostEnv(t)
	id := e.newDownload(models.Download{})

	parent, cancel := context.WithCancel(context.Background())
	cancel()
	runCtx := context.Background() // the run itself was not cancelled: this is a real failure

	e.mgr.finishError(parent, runCtx, id, "https://example.test/watch?v=1", "boom", "", "")

	if got := e.download(id); got.Status != models.StatusFailed {
		t.Fatalf("status = %q, want %q (terminal write lost with the cancelled context)", got.Status, models.StatusFailed)
	}
}

// A run cut short by the shutdown itself is not a user cancel: the row is left for startup recovery
// to mark interrupted, never recorded as "cancelled by user".
func TestFinishErrorLeavesShutdownInterruptedRunAlone(t *testing.T) {
	e := newGhostEnv(t)
	id := e.newDownload(models.Download{})
	if err := e.downloads.UpdateStatus(context.Background(), id, models.StatusDownloading, nil); err != nil {
		t.Fatal(err)
	}

	parent, cancel := context.WithCancel(context.Background())
	cancel()
	runCtx, runCancel := context.WithCancel(parent) // derived, so cancelled too
	defer runCancel()

	e.mgr.finishError(parent, runCtx, id, "https://example.test/watch?v=1", "context canceled", "", "")

	if got := e.download(id); got.Status != models.StatusDownloading {
		t.Fatalf("status = %q, want %q left for startup recovery", got.Status, models.StatusDownloading)
	}
}

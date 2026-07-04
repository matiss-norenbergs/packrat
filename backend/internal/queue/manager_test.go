package queue

import (
	"context"
	"testing"
	"time"

	"packrat/backend/internal/ws"
)

// TestSetWorkerCount exercises the pool-size bookkeeping in isolation — no
// jobs are ever enqueued, so workers just idle on <-m.jobs and it's safe to
// construct the manager with nil ytdlp/repos (never dereferenced without a
// job). The "shrinking doesn't cancel an in-flight download" behavior itself
// is covered by a real end-to-end run (see docs/architecture.md); this test
// is just the deterministic size-tracking part.
func TestSetWorkerCount(t *testing.T) {
	mgr := NewDownloadManager("", nil, nil, nil, nil, NewProgressStore(), ws.NoopBroadcaster{})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	mgr.Start(ctx, 3)
	if got := mgr.WorkerCount(); got != 3 {
		t.Fatalf("expected 3 workers after Start, got %d", got)
	}

	mgr.SetWorkerCount(1)
	if got := mgr.WorkerCount(); got != 1 {
		t.Fatalf("expected 1 worker after shrink, got %d", got)
	}

	mgr.SetWorkerCount(5)
	if got := mgr.WorkerCount(); got != 5 {
		t.Fatalf("expected 5 workers after growth, got %d", got)
	}

	mgr.SetWorkerCount(0)
	if got := mgr.WorkerCount(); got != 0 {
		t.Fatalf("expected 0 workers after shrink to zero, got %d", got)
	}

	// Give any exiting goroutines a moment before the context is cancelled,
	// just so a failure here isn't masked by process teardown.
	time.Sleep(10 * time.Millisecond)
}

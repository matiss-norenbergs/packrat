package main

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"packrat/backend/internal/bgtasks"
)

// shutdown must cancel the root context only after the HTTP server stopped, and must not return
// until background jobs (which finish their final write after the cancel) are done — the caller
// closes the database right after it returns.
func TestShutdownWaitsForJobsAfterCancellingRoot(t *testing.T) {
	root, cancelRoot := context.WithCancel(context.Background())
	defer cancelRoot()
	tasks := &bgtasks.Tracker{}

	var wroteFinalState atomic.Bool
	tasks.Go(func() {
		<-root.Done()
		time.Sleep(150 * time.Millisecond) // a terminal write that takes a moment
		wroteFinalState.Store(true)
	})
	var embedsWaited atomic.Bool

	srv := &http.Server{}
	if err := shutdown(srv, cancelRoot, tasks, func() { embedsWaited.Store(true) }, nil); err != nil {
		t.Fatalf("shutdown: %v", err)
	}
	if !wroteFinalState.Load() {
		t.Fatal("shutdown returned before the background job finished its final write")
	}
	if !embedsWaited.Load() {
		t.Fatal("shutdown did not wait for metadata embeds")
	}
	if root.Err() == nil {
		t.Fatal("root context was not cancelled")
	}
}

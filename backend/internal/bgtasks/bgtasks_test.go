package bgtasks

import (
	"context"
	"runtime"
	"testing"
	"time"
)

func TestWaitReturnsOnceJobsFinish(t *testing.T) {
	var tr Tracker
	release := make(chan struct{})
	for i := 0; i < 3; i++ {
		tr.Go(func() { <-release })
	}
	if got := tr.Running(); got != 3 {
		t.Fatalf("Running = %d, want 3", got)
	}
	go func() {
		time.Sleep(30 * time.Millisecond)
		close(release)
	}()
	if !tr.Wait(2 * time.Second) {
		t.Fatal("Wait timed out although jobs finished")
	}
	if got := tr.Running(); got != 0 {
		t.Fatalf("Running after Wait = %d, want 0", got)
	}
}

func TestWaitTimesOutAndReportsRemaining(t *testing.T) {
	var tr Tracker
	release := make(chan struct{})
	tr.Go(func() { <-release })
	tr.Go(func() { <-release })
	if tr.Wait(30 * time.Millisecond) {
		t.Fatal("Wait returned true with jobs still running")
	}
	if got := tr.Running(); got != 2 {
		t.Fatalf("Running = %d, want 2", got)
	}
	close(release)
	if !tr.Wait(2 * time.Second) {
		t.Fatal("Wait timed out after release")
	}
}

func TestWaitWithNothingRunning(t *testing.T) {
	var tr Tracker
	if !tr.Wait(time.Millisecond) {
		t.Fatal("Wait on an idle tracker must return true")
	}
}

func TestNilTrackerStillRuns(t *testing.T) {
	var tr *Tracker
	done := make(chan struct{})
	tr.Go(func() { close(done) })
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("nil tracker did not run the function")
	}
	if !tr.Wait(time.Millisecond) || tr.Running() != 0 {
		t.Fatal("nil tracker must report idle")
	}
}

func TestNoGoroutineLeak(t *testing.T) {
	before := runtime.NumGoroutine()
	var tr Tracker
	for i := 0; i < 50; i++ {
		tr.Go(func() { time.Sleep(time.Millisecond) })
	}
	if !tr.Wait(2 * time.Second) {
		t.Fatal("Wait timed out")
	}
	// Goroutines exit just after done(); give the scheduler a moment.
	deadline := time.Now().Add(time.Second)
	for runtime.NumGoroutine() > before && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if after := runtime.NumGoroutine(); after > before {
		t.Fatalf("goroutines leaked: before=%d after=%d", before, after)
	}
}

func TestTerminalContextSurvivesCancel(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	cancel()
	ctx, done := TerminalContext(parent)
	defer done()
	if ctx.Err() != nil {
		t.Fatalf("terminal context already done: %v", ctx.Err())
	}
	if _, ok := ctx.Deadline(); !ok {
		t.Fatal("terminal context must be bounded by a deadline")
	}
}

func TestRunnerUsesRootContextAndTracks(t *testing.T) {
	var tr Tracker
	root, cancel := context.WithCancel(context.Background())
	r := Runner{Ctx: root, Tracker: &tr}
	sawCancel := make(chan bool, 1)
	r.Go(func(ctx context.Context) {
		<-ctx.Done()
		sawCancel <- true
	})
	if tr.Running() != 1 {
		t.Fatalf("Running = %d, want 1", tr.Running())
	}
	cancel()
	if !tr.Wait(2 * time.Second) {
		t.Fatal("Wait timed out")
	}
	if !<-sawCancel {
		t.Fatal("job did not observe the root context")
	}

	var zero Runner
	ran := make(chan struct{})
	zero.Go(func(ctx context.Context) {
		if ctx == nil {
			t.Error("nil context")
		}
		close(ran)
	})
	<-ran
}

func TestCompletionContext(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	cancel()
	before := time.Now()
	ctx, done := CompletionContext(parent)
	defer done()
	if ctx.Err() != nil {
		t.Fatalf("completion context already done: %v", ctx.Err())
	}
	dl, ok := ctx.Deadline()
	if !ok {
		t.Fatal("completion context must have a deadline")
	}
	if got := dl.Sub(before); got < CompletionWriteTimeout-time.Second || got > CompletionWriteTimeout+time.Second {
		t.Fatalf("deadline in %v, want about %v", got, CompletionWriteTimeout)
	}
	if CompletionWriteTimeout < 10*TerminalWriteTimeout {
		t.Fatalf("CompletionWriteTimeout %v is not well above %v", CompletionWriteTimeout, TerminalWriteTimeout)
	}
}

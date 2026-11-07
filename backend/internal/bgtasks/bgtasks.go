// Package bgtasks tracks long-lived and detached goroutines so shutdown can
// wait for them (bounded) before the database is closed.
package bgtasks

import (
	"context"
	"sync"
	"time"
)

// TerminalWriteTimeout bounds a terminal write (marking a row done / failed /
// cancelled, recording history) made through TerminalContext.
const TerminalWriteTimeout = 5 * time.Second

// Tracker counts running goroutines started through Go. The zero value is
// ready to use. A nil *Tracker is valid too: Go then just starts an untracked
// goroutine, so code (and tests) that was never wired to a tracker still works.
type Tracker struct {
	mu      sync.Mutex
	running int
	waiters []chan struct{}
}

// Go runs fn in a new goroutine and tracks it until fn returns.
func (t *Tracker) Go(fn func()) {
	if t == nil {
		go fn()
		return
	}
	t.mu.Lock()
	t.running++
	t.mu.Unlock()
	go func() {
		defer t.done()
		fn()
	}()
}

func (t *Tracker) done() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.running--
	if t.running == 0 {
		for _, w := range t.waiters {
			close(w)
		}
		t.waiters = nil
	}
}

// Running reports how many tracked goroutines have not returned yet.
func (t *Tracker) Running() int {
	if t == nil {
		return 0
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.running
}

// Wait blocks until every tracked goroutine has returned or timeout elapses.
// It reports whether everything finished; on false, Running says how many are
// left. Goroutines started while waiting are waited for too.
func (t *Tracker) Wait(timeout time.Duration) bool {
	if t == nil {
		return true
	}
	t.mu.Lock()
	if t.running == 0 {
		t.mu.Unlock()
		return true
	}
	ch := make(chan struct{})
	t.waiters = append(t.waiters, ch)
	t.mu.Unlock()

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-ch:
		return true
	case <-timer.C:
		return false
	}
}

// TerminalContext returns a context for a write that must succeed even though
// ctx is already cancelled (shutdown): it keeps ctx's values but not its
// cancellation, and is bounded by TerminalWriteTimeout.
func TerminalContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), TerminalWriteTimeout)
}

// Runner starts jobs that outlive the request that triggered them. They run
// under the server's root context (cancelled on shutdown) and are tracked so
// shutdown can wait for them. The zero value runs jobs under
// context.Background, untracked.
type Runner struct {
	Ctx     context.Context
	Tracker *Tracker
}

// Go runs fn in the background with the runner's context.
func (r Runner) Go(fn func(ctx context.Context)) {
	ctx := r.Ctx
	if ctx == nil {
		ctx = context.Background()
	}
	r.Tracker.Go(func() { fn(ctx) })
}

// CompletionWriteTimeout bounds the writes that record a successful outcome (see CompletionContext).
// It is only a safety net against a wedged database, not an expectation: the database has a single
// connection, so a backup, restore or big delete can legitimately keep a write waiting for a while.
const CompletionWriteTimeout = 2 * time.Minute

// CompletionContext is for the success-path writes that decide whether finished work is kept (the
// library row of a completed download, marking it completed, a frame match's result). Like
// TerminalContext it survives cancellation of ctx, so it works during shutdown, but its bound is
// CompletionWriteTimeout: a short bound there would fail a write that merely queued behind another
// transaction and make the caller discard work that had already been done. Use TerminalContext for
// bookkeeping that only records a failure.
//
// A completion write does not extend shutdown: the shutdown wait is itself bounded (15 s), and a
// write cut off by process exit is recovered at the next start (MarkInterruptedIfActive, the
// frame-match reset).
func CompletionContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), CompletionWriteTimeout)
}

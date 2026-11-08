package queue

import (
	"context"
	"sync"
)

// jobQueue is the manager's unbounded in-memory FIFO of download ids waiting
// for a worker. The persisted `downloads` rows are the source of truth; this
// is only the hand-off order, so it is rebuilt empty at startup (queued rows
// are marked interrupted then, see DownloadsRepo.MarkInterruptedIfActive).
//
// Push never blocks: it is a short mutex-guarded append, so an enqueue loop of
// any size returns at once instead of stalling behind busy workers the way a
// bounded channel did. The mutex is held only for slice bookkeeping, never
// across DB calls or I/O.
//
// Wakeups: a consumer that finds the queue empty registers a private
// one-slot channel in `waiters` (under the same lock that observed "empty"),
// then sleeps on it. Push appends and hands exactly one wake token to the
// oldest waiter. Registering and observing emptiness are atomic, so a push
// cannot slip between "saw empty" and "started waiting" (no lost wakeup), and
// one push wakes one consumer (no thundering herd). A consumer that is woken
// but loses the race for the item simply re-registers; a consumer that
// leaves (stop/ctx) after it was already handed a token passes the token on,
// so a pushed id is never stranded while another consumer sleeps.
type jobQueue struct {
	mu      sync.Mutex
	items   []int64
	waiters []chan struct{}
}

func newJobQueue() *jobQueue { return &jobQueue{} }

// Push appends id and wakes one waiting consumer, if any. Never blocks.
func (q *jobQueue) Push(id int64) {
	q.mu.Lock()
	q.items = append(q.items, id)
	q.wakeOneLocked()
	q.mu.Unlock()
}

// wakeOneLocked hands a wake token to the oldest waiter. The waiter channel
// has a one-slot buffer, so the send never blocks. q.mu must be held.
func (q *jobQueue) wakeOneLocked() {
	if len(q.waiters) == 0 {
		return
	}
	w := q.waiters[0]
	q.waiters[0] = nil
	q.waiters = q.waiters[1:]
	w <- struct{}{}
}

// Pop removes and returns the oldest id, waiting while the queue is empty. It
// returns ok=false, without taking anything, once stop is closed or ctx is
// done. Either may be nil (never fires). Items stay queued when Pop gives up.
func (q *jobQueue) Pop(ctx context.Context, stop <-chan struct{}) (id int64, ok bool) {
	var done <-chan struct{}
	if ctx != nil {
		done = ctx.Done()
	}
	for {
		q.mu.Lock()
		// Check for shutdown/stop first so a closing worker never takes an
		// item it would then run (or hand over) while it is being retired.
		select {
		case <-stop:
			q.passOnLocked()
			q.mu.Unlock()
			return 0, false
		case <-done:
			q.passOnLocked()
			q.mu.Unlock()
			return 0, false
		default:
		}
		if len(q.items) > 0 {
			id = q.items[0]
			q.items = q.items[1:]
			if len(q.items) == 0 {
				q.items = nil // drop the consumed backing array
			}
			q.mu.Unlock()
			return id, true
		}
		w := make(chan struct{}, 1)
		q.waiters = append(q.waiters, w)
		q.mu.Unlock()

		select {
		case <-w:
			// Woken: loop and try to take an item.
		case <-stop:
			q.leave(w)
			return 0, false
		case <-done:
			q.leave(w)
			return 0, false
		}
	}
}

// leave unregisters a waiter that is giving up. If a push already handed it a
// token (it was removed from waiters), the token is forwarded so the pushed id
// does not sit unserved while another consumer sleeps.
func (q *jobQueue) leave(w chan struct{}) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for i, x := range q.waiters {
		if x == w {
			q.waiters = append(q.waiters[:i], q.waiters[i+1:]...)
			return
		}
	}
	// Already signalled: pass the wake on if there is still work.
	q.passOnLocked()
}

// passOnLocked wakes another consumer when work remains. A consumer that was
// handed a wake token but is leaving instead of taking the item calls it so
// the token is not lost; a spurious wake is harmless (the woken consumer
// re-checks and re-registers).
func (q *jobQueue) passOnLocked() {
	if len(q.items) > 0 {
		q.wakeOneLocked()
	}
}

// Remove drops a still-queued id and reports whether it was there. An id a
// worker has already taken is not found (false).
func (q *jobQueue) Remove(id int64) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	for i, x := range q.items {
		if x == id {
			q.items = append(q.items[:i], q.items[i+1:]...)
			return true
		}
	}
	return false
}

// Len is the number of ids waiting for a worker.
func (q *jobQueue) Len() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.items)
}

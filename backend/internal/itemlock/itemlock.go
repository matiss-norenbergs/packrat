// Package itemlock is a keyed mutex over library item IDs. Anything that
// rewrites, moves or deletes an item's media file holds the item's lock for
// the duration, so the background metadata remux (which can run for minutes)
// and a user-triggered file operation can never interleave.
package itemlock

import "sync"

// Locks hands out one mutex per library item ID. Entries exist only while
// somebody holds or waits for the lock, so the map never grows with the
// number of items ever touched. The zero value is not usable; call New.
type Locks struct {
	mu      sync.Mutex
	entries map[int64]*entry
}

type entry struct {
	// held is true while some goroutine owns the lock. Waiters block on cond.
	held bool
	// refs counts owners plus waiters; the entry is deleted when it hits 0.
	refs int
	cond *sync.Cond
}

// New returns an empty lock set.
func New() *Locks {
	return &Locks{entries: make(map[int64]*entry)}
}

// Lock blocks until the lock for id is free, then takes it.
func (l *Locks) Lock(id int64) {
	l.mu.Lock()
	e := l.entries[id]
	if e == nil {
		e = &entry{cond: sync.NewCond(&l.mu)}
		l.entries[id] = e
	}
	e.refs++
	for e.held {
		e.cond.Wait()
	}
	e.held = true
	l.mu.Unlock()
}

// TryLock takes the lock for id if it is free and reports whether it did.
// It never blocks, so request handlers use it to answer 409 instead of
// hanging behind a long remux.
func (l *Locks) TryLock(id int64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.entries[id]
	if e != nil && e.held {
		return false
	}
	if e == nil {
		e = &entry{cond: sync.NewCond(&l.mu)}
		l.entries[id] = e
	}
	e.refs++
	e.held = true
	return true
}

// Unlock releases the lock for id. It panics if id is not locked, like
// sync.Mutex does for an unlock of an unlocked mutex.
func (l *Locks) Unlock(id int64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.entries[id]
	if e == nil || !e.held {
		panic("itemlock: unlock of unlocked item")
	}
	e.held = false
	e.refs--
	if e.refs == 0 {
		delete(l.entries, id)
		return
	}
	e.cond.Signal()
}

// TryLockAll takes the locks for every id (duplicates are taken once) or, if
// any is busy, none of them. The returned func releases whatever was taken;
// it is always non-nil and safe to call once.
func (l *Locks) TryLockAll(ids []int64) (release func(), ok bool) {
	taken := make([]int64, 0, len(ids))
	seen := make(map[int64]bool, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		if !l.TryLock(id) {
			for _, t := range taken {
				l.Unlock(t)
			}
			return func() {}, false
		}
		taken = append(taken, id)
	}
	return func() {
		for _, t := range taken {
			l.Unlock(t)
		}
	}, true
}

// Len reports how many items currently have a lock entry (held or awaited).
// Exposed for tests asserting the map is cleaned up.
func (l *Locks) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.entries)
}

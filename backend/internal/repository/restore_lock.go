package repository

import "sync"

// Lock order (see docs/architecture.md): a repo mutex (TagsRepo.mu,
// ArtistsRepo.mu, CollectionsRepo.mu) is always taken BEFORE the write
// transaction, never while one is open. The database is a small connection
// pool, but SQLite still has one writer at a time and every transaction takes
// the write lock when it begins (_txlock=immediate). A goroutine that holds a
// mutex and waits for the write lock while another holds the write lock (an
// open tx) and waits for the mutex is still a deadlock between the two. What
// changed with the pool is the blast radius: reads keep working, and the
// mutex holder gives up after db.BusyTimeout with "database is locked" (a 503)
// instead of the whole app hanging for good. That is a bug, not a recovery
// path.
//
// A caller that needs a transaction spanning several of these repos therefore
// takes their mutexes up front with LockForRestore, then opens the tx, and
// hands the lock to each repo's WithLockedTx so the tx-scoped copies don't
// try to take the (non-reentrant) mutex again.

// RestoreLock is a held set of repo mutexes. Obtain one with LockForRestore.
type RestoreLock struct {
	held []*sync.Mutex
	once sync.Once
}

// LockForRestore takes the tags, artists and collections mutexes in that
// fixed order (so two lock-takers can never deadlock each other) and returns
// a RestoreLock; the caller must call Unlock once the transaction has
// committed or rolled back. It must be called BEFORE db.BeginTx. A nil repo
// is skipped.
func LockForRestore(tags *TagsRepo, artists *ArtistsRepo, collections *CollectionsRepo) *RestoreLock {
	l := &RestoreLock{}
	if tags != nil {
		tags.mu.Lock()
		l.held = append(l.held, tags.mu)
	}
	if artists != nil {
		artists.mu.Lock()
		l.held = append(l.held, artists.mu)
	}
	if collections != nil {
		collections.mu.Lock()
		l.held = append(l.held, collections.mu)
	}
	return l
}

// Unlock releases the mutexes in reverse order. Safe to call more than once.
func (l *RestoreLock) Unlock() {
	l.once.Do(func() {
		for i := len(l.held) - 1; i >= 0; i-- {
			l.held[i].Unlock()
		}
	})
}

// holds reports whether l holds mu.
func (l *RestoreLock) holds(mu *sync.Mutex) bool {
	if l == nil {
		return false
	}
	for _, m := range l.held {
		if m == mu {
			return true
		}
	}
	return false
}

// lockOrSkip takes mu unless this repo copy is a tx-scoped one whose creator
// already holds it; it returns the matching unlock. Use as
// `defer r.lock()()`.
func lockOrSkip(mu *sync.Mutex, lockHeld bool) func() {
	if lockHeld {
		return func() {}
	}
	mu.Lock()
	return mu.Unlock
}

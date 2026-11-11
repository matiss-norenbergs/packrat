package main

import (
	"context"
	"log"
	"time"

	"packrat/backend/internal/db"
)

// sessionSweepInterval is how often expired sessions are deleted. Expired rows are already
// rejected on lookup, so this is housekeeping and a day is plenty.
const sessionSweepInterval = 24 * time.Hour

// expiredSessionDeleter is what the sweep needs from the users repository.
type expiredSessionDeleter interface {
	DeleteExpiredSessions(ctx context.Context) (int64, error)
}

// sweepExpiredSessions deletes expired sessions once. It logs only when something was removed or
// the sweep failed; a busy database (writes queued behind another writer) is logged as such and
// left for the next tick, never fatal.
func sweepExpiredSessions(ctx context.Context, repo expiredSessionDeleter) {
	n, err := repo.DeleteExpiredSessions(ctx)
	switch {
	case err == nil:
		if n > 0 {
			log.Printf("session cleanup: removed %d expired session(s)", n)
		}
	case ctx.Err() != nil:
		// shutting down
	case db.IsBusy(err):
		log.Printf("session cleanup: database busy, trying again in %s", sessionSweepInterval)
	default:
		log.Printf("session cleanup failed: %v", err)
	}
}

// runSessionSweep sweeps once immediately (startup, after migrations) and then every interval
// until ctx is cancelled. Start it through the bgtasks tracker so shutdown waits for it.
func runSessionSweep(ctx context.Context, repo expiredSessionDeleter, interval time.Duration) {
	sweepExpiredSessions(ctx, repo)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sweepExpiredSessions(ctx, repo)
		}
	}
}

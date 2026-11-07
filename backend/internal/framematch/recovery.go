package framematch

import (
	"context"

	"packrat/backend/internal/repository"
)

// ResetInterrupted runs once at startup, before RunQueue: any row still
// "running" belonged to a process that is gone, so it becomes an error row
// with InterruptedMessage. It is not requeued automatically — a file that
// crashes the process would otherwise crash-loop the server. The user
// discards the error row and queues the item again. Returns how many rows
// were reset.
func ResetInterrupted(ctx context.Context, repo *repository.FrameMatchQueueRepo) (int64, error) {
	return repo.ResetRunning(ctx, InterruptedMessage)
}

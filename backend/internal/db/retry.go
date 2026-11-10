package db

import (
	"context"
	"time"
)

const (
	retryFirstDelay = 50 * time.Millisecond
	retryMaxDelay   = time.Second
)

// RetryBusy runs op and, while it fails with a busy error (IsBusy) and ctx is
// still alive, waits and runs it again, backing off from 50 ms to 1 s. It
// returns op's last error, or ctx's error if ctx ended during a wait.
//
// It exists for background writes that record finished work (a completed
// download, a frame-match result): they run under a context that tolerates a
// long wait (bgtasks.CompletionContext), longer than BusyTimeout, and failing
// them would make the caller discard work that was already done. Only wrap an
// op whose failure with a busy error means NOTHING was applied (a single
// statement, or a transaction that failed to begin): a busy error never
// leaves a statement half done, but an op made of several statements would
// repeat the ones that had already succeeded.
func RetryBusy(ctx context.Context, op func() error) error {
	delay := retryFirstDelay
	for {
		err := op()
		if err == nil || !IsBusy(err) {
			return err
		}
		select {
		case <-ctx.Done():
			return err
		case <-time.After(delay):
		}
		if delay *= 2; delay > retryMaxDelay {
			delay = retryMaxDelay
		}
	}
}

// RetryBusyValue is RetryBusy for an op that also returns a value.
func RetryBusyValue[T any](ctx context.Context, op func() (T, error)) (T, error) {
	var out T
	err := RetryBusy(ctx, func() error {
		var err error
		out, err = op()
		return err
	})
	return out, err
}

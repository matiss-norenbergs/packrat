package framematch

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	"packrat/backend/internal/downloader"
)

// matchTimeout bounds a single match run — a safety net against a
// pathological video (or a wedged ffmpeg process) leaving a job or queue
// item stuck forever. It applies to the match itself (the clock starts once
// matchSem is held), for single-item jobs and for each queue item alike.
const matchTimeout = 5 * time.Minute

// jobTTL is how long a finished job stays pollable before the JobStore drops
// it (each finished job holds two base64 JPEGs). Running jobs never expire.
const jobTTL = 30 * time.Minute

// matchSem serializes every call to Match, regardless of trigger (an ad-hoc
// single-item request here, or RunQueue's bulk background worker) — ffmpeg
// decode is CPU-bound and the container's CPU budget is capped, so two
// matches running at once would just fight over the same limited CPU
// instead of finishing any faster. A channel rather than a sync.Mutex so
// that waiting for it can be cancelled.
var matchSem = make(chan struct{}, 1)

// runExclusive waits for matchSem (cancellable via ctx, and not counted
// against the match's time budget), then runs fn with a ctx that expires
// after timeout. A timeout is reported as a clear error rather than a bare
// "context deadline exceeded".
func runExclusive(ctx context.Context, timeout time.Duration, fn func(ctx context.Context) (Result, error)) (Result, error) {
	select {
	case matchSem <- struct{}{}:
	case <-ctx.Done():
		return Result{}, ctx.Err()
	}
	defer func() { <-matchSem }()

	mctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	res, err := fn(mctx)
	if err != nil && ctx.Err() == nil && errors.Is(mctx.Err(), context.DeadlineExceeded) {
		return Result{}, fmt.Errorf("match timed out after %s", timeout)
	}
	return res, err
}

// JobStatus is a snapshot of one match job.
type JobStatus struct {
	State    string // "running", "done", "error"
	Result   *Result
	ErrorMsg string

	finishedAt time.Time // zero while running
}

// JobStore runs Match in the background and lets callers poll for its
// result — matching a single item routinely takes tens of seconds to a
// couple of minutes (see match.go's doc comment), far too long to hold a
// single HTTP request open, but this is a low-frequency, one-at-a-time
// manual action rather than a bulk operation, so a simple in-memory map is
// enough — no queueing, persistence, or the WebSocket broadcast machinery
// internal/thumbnailenhance uses for its bulk sweeps. Finished jobs are
// evicted jobTTL after they finish; the sweep runs on each Start/Get.
type JobStore struct {
	mu   sync.Mutex
	jobs map[string]*JobStatus

	baseCtx context.Context
	timeout time.Duration
	ttl     time.Duration
	now     func() time.Time
}

func NewJobStore() *JobStore {
	return &JobStore{
		jobs:    make(map[string]*JobStatus),
		baseCtx: context.Background(),
		timeout: matchTimeout,
		ttl:     jobTTL,
		now:     time.Now,
	}
}

// SetBaseContext makes jobs (including their wait for the match lock) stop
// when ctx is cancelled, e.g. on server shutdown. Call before Start.
func (s *JobStore) SetBaseContext(ctx context.Context) { s.baseCtx = ctx }

// sweepLocked drops finished jobs older than the TTL. s.mu must be held.
func (s *JobStore) sweepLocked() {
	now := s.now()
	for id, j := range s.jobs {
		if !j.finishedAt.IsZero() && now.Sub(j.finishedAt) >= s.ttl {
			delete(s.jobs, id)
		}
	}
}

// Start kicks off a match run in the background and returns its job ID
// immediately. referenceJPEG is already-decoded JPEG bytes — resolving
// which image that is (the item's current thumbnail file, or a freshly
// fetched-and-decoded source-URL thumbnail) is the caller's job.
func (s *JobStore) Start(ytdlp *downloader.YtDlpService, ffprobePath, videoAbsPath string, referenceJPEG []byte) string {
	return s.startFunc(func(ctx context.Context) (Result, error) {
		return Match(ctx, ytdlp, ffprobePath, videoAbsPath, referenceJPEG)
	})
}

func (s *JobStore) startFunc(fn func(ctx context.Context) (Result, error)) string {
	id := uuid.NewString()
	s.mu.Lock()
	s.sweepLocked()
	s.jobs[id] = &JobStatus{State: "running"}
	s.mu.Unlock()

	go func() {
		result, err := runExclusive(s.baseCtx, s.timeout, fn)

		s.mu.Lock()
		defer s.mu.Unlock()
		if err != nil {
			s.jobs[id] = &JobStatus{State: "error", ErrorMsg: err.Error(), finishedAt: s.now()}
			return
		}
		s.jobs[id] = &JobStatus{State: "done", Result: &result, finishedAt: s.now()}
	}()

	return id
}

func (s *JobStore) Get(id string) (JobStatus, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	j, ok := s.jobs[id]
	if !ok {
		return JobStatus{}, false
	}
	return *j, true
}

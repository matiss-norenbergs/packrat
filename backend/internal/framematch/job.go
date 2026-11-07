package framematch

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/importer"
)

// matchTimeout is the minimum bound on a single match run — a safety net
// against a pathological video (or a wedged ffmpeg process) leaving a job or
// queue item stuck forever. The bound applies to the match itself (the clock
// starts once matchSem is held), for single-item jobs and each queue item
// alike, and grows with the video's length (matchTimeoutFor).
const matchTimeout = 5 * time.Minute

// maxMatchTimeout caps the length-scaled bound.
const maxMatchTimeout = 60 * time.Minute

// probeDurationTimeout bounds the ffprobe call that reads a video's length.
const probeDurationTimeout = 10 * time.Second

// matchTimeoutFor returns the time budget for matching a video of the given
// length: clamp(duration/4 + 2min, matchTimeout, maxMatchTimeout). A match
// costs roughly 4.8 s of work per minute of video (4 fps sweep plus ten
// refined windows), so duration/4 (15 s per minute) leaves about 3x headroom,
// and the fixed 2 minutes cover startup and the per-window seeks. A zero or
// negative duration means unknown and gets the flat matchTimeout.
func matchTimeoutFor(duration time.Duration) time.Duration {
	if duration <= 0 {
		return matchTimeout
	}
	t := duration/4 + 2*time.Minute
	if t < matchTimeout {
		return matchTimeout
	}
	if t > maxMatchTimeout {
		return maxMatchTimeout
	}
	return t
}

// probeVideoDuration reads a file's duration with ffprobe under its own short
// timeout; 0 means unknown (any failure).
func probeVideoDuration(ctx context.Context, ffprobePath, path string) time.Duration {
	ctx, cancel := context.WithTimeout(ctx, probeDurationTimeout)
	defer cancel()
	if p := importer.Probe(ctx, ffprobePath, path); p.DurationSeconds != nil {
		return time.Duration(*p.DurationSeconds) * time.Second
	}
	return 0
}

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
	// timeout, when non-zero, overrides the length-scaled budget (tests).
	timeout time.Duration
	// probe reads a video's duration (0 = unknown); injectable for tests.
	probe func(ctx context.Context, ffprobePath, path string) time.Duration
	ttl   time.Duration
	now   func() time.Time
}

func NewJobStore() *JobStore {
	return &JobStore{
		jobs:    make(map[string]*JobStatus),
		baseCtx: context.Background(),
		probe:   probeVideoDuration,
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
	dur := func(ctx context.Context) time.Duration { return s.probe(ctx, ffprobePath, videoAbsPath) }
	return s.startWithDuration(dur, func(ctx context.Context) (Result, error) {
		return Match(ctx, ytdlp, ffprobePath, videoAbsPath, referenceJPEG)
	})
}

func (s *JobStore) startFunc(fn func(ctx context.Context) (Result, error)) string {
	return s.startWithDuration(nil, fn)
}

// startWithDuration runs fn like startFunc; dur (nil = unknown) supplies the
// video length that sizes the time budget. It is called before waiting for the
// match lock, so probing is not counted against the match.
func (s *JobStore) startWithDuration(dur func(ctx context.Context) time.Duration, fn func(ctx context.Context) (Result, error)) string {
	id := uuid.NewString()
	s.mu.Lock()
	s.sweepLocked()
	s.jobs[id] = &JobStatus{State: "running"}
	s.mu.Unlock()

	go func() {
		timeout := s.timeout
		if timeout <= 0 {
			var d time.Duration
			if dur != nil {
				d = dur(s.baseCtx)
			}
			timeout = matchTimeoutFor(d)
		}
		result, err := runExclusive(s.baseCtx, timeout, fn)

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

package framematch

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"

	"packrat/backend/internal/downloader"
)

// matchTimeout bounds a single match run — a safety net against a
// pathological video (or a wedged ffmpeg process) leaving a job stuck in
// "running" forever, independent of the HTTP request that started it (the
// job runs on its own background context, not the request's).
const matchTimeout = 5 * time.Minute

// matchMu serializes every call to Match, regardless of trigger (an ad-hoc
// single-item request here, or RunQueue's bulk background worker) — ffmpeg
// decode is CPU-bound and the container's CPU budget is capped, so two
// matches running at once would just fight over the same limited CPU
// instead of finishing any faster.
var matchMu sync.Mutex

// JobStatus is a snapshot of one match job.
type JobStatus struct {
	State    string // "running", "done", "error"
	Result   *Result
	ErrorMsg string
}

// JobStore runs Match in the background and lets callers poll for its
// result — matching a single item routinely takes tens of seconds to a
// couple of minutes (see match.go's doc comment), far too long to hold a
// single HTTP request open, but this is a low-frequency, one-at-a-time
// manual action rather than a bulk operation, so a simple in-memory map is
// enough — no queueing, persistence, or the WebSocket broadcast machinery
// internal/thumbnailenhance uses for its bulk sweeps.
type JobStore struct {
	mu   sync.Mutex
	jobs map[string]*JobStatus
}

func NewJobStore() *JobStore {
	return &JobStore{jobs: make(map[string]*JobStatus)}
}

// Start kicks off a match run in the background and returns its job ID
// immediately. referenceJPEG is already-decoded JPEG bytes — resolving
// which image that is (the item's current thumbnail file, or a freshly
// fetched-and-decoded source-URL thumbnail) is the caller's job.
func (s *JobStore) Start(ytdlp *downloader.YtDlpService, ffprobePath, videoAbsPath string, referenceJPEG []byte) string {
	id := uuid.NewString()
	s.mu.Lock()
	s.jobs[id] = &JobStatus{State: "running"}
	s.mu.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), matchTimeout)
		defer cancel()

		matchMu.Lock()
		result, err := Match(ctx, ytdlp, ffprobePath, videoAbsPath, referenceJPEG)
		matchMu.Unlock()

		s.mu.Lock()
		defer s.mu.Unlock()
		if err != nil {
			s.jobs[id] = &JobStatus{State: "error", ErrorMsg: err.Error()}
			return
		}
		s.jobs[id] = &JobStatus{State: "done", Result: &result}
	}()

	return id
}

func (s *JobStore) Get(id string) (JobStatus, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	if !ok {
		return JobStatus{}, false
	}
	return *j, true
}

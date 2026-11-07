// Package metaembed schedules the background "write title/artist/year into the
// file's own container tags" remux. Each remux rewrites a whole media file, so
// it is serialized per library item (holding the item's itemlock for the whole
// run), coalesced (at most one running plus one pending per item, latest values
// win) and bounded globally by a small semaphore.
package metaembed

import (
	"context"
	"errors"
	"log"
	"path/filepath"
	"sync"
	"time"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/itemlock"
)

// Request is the tag values to write.
type Request struct {
	Title          string
	Artist         *string
	Year           *int
	SequenceNumber *int
	SeasonNumber   *int
}

// Embedder performs one remux. *downloader.YtDlpService satisfies it.
type Embedder interface {
	EmbedMetadataGuarded(ctx context.Context, mediaPath, title string, artist *string, year, sequenceNumber, seasonNumber *int, beforeReplace func() bool) error
}

// CurrentPathFunc returns the item's current absolute media path, or ok=false
// if the item no longer exists or has no file.
type CurrentPathFunc func(ctx context.Context, itemID int64) (path string, ok bool)

type job struct {
	path string
	req  Request
}

type itemState struct {
	pending *job
}

// Scheduler runs and coalesces embeds. Safe for concurrent use.
type Scheduler struct {
	locks       *itemlock.Locks
	embedder    Embedder
	currentPath CurrentPathFunc
	sem         chan struct{}

	mu    sync.Mutex
	state map[int64]*itemState
	wg    sync.WaitGroup
}

// New builds a Scheduler. maxConcurrent bounds simultaneous ffmpeg remuxes
// across all items.
func New(locks *itemlock.Locks, embedder Embedder, currentPath CurrentPathFunc, maxConcurrent int) *Scheduler {
	if maxConcurrent < 1 {
		maxConcurrent = 1
	}
	return &Scheduler{
		locks:       locks,
		embedder:    embedder,
		currentPath: currentPath,
		sem:         make(chan struct{}, maxConcurrent),
		state:       make(map[int64]*itemState),
	}
}

// Submit asks for path (the item's media file) to be re-tagged with req. It
// never blocks. If a run for the item is already in flight, req replaces any
// earlier pending request and runs once the current one finishes; so a burst
// of N saves costs at most one running plus one pending remux.
func (s *Scheduler) Submit(itemID int64, path string, req Request) {
	j := &job{path: path, req: req}
	s.mu.Lock()
	if st, busy := s.state[itemID]; busy {
		st.pending = j
		s.mu.Unlock()
		return
	}
	s.state[itemID] = &itemState{}
	s.mu.Unlock()

	s.wg.Add(1)
	go s.drain(itemID, j)
}

// Wait blocks until every submitted embed has finished. For tests and
// graceful shutdown.
func (s *Scheduler) Wait() { s.wg.Wait() }

func (s *Scheduler) drain(itemID int64, j *job) {
	defer s.wg.Done()
	for {
		s.runOne(itemID, j)

		s.mu.Lock()
		st := s.state[itemID]
		next := st.pending
		if next == nil {
			delete(s.state, itemID)
			s.mu.Unlock()
			return
		}
		st.pending = nil
		s.mu.Unlock()
		j = next
	}
}

func (s *Scheduler) runOne(itemID int64, j *job) {
	// Global cap first, then the item lock: a job queued behind the cap does
	// not hold the item's lock, so user operations aren't refused for it.
	s.sem <- struct{}{}
	defer func() { <-s.sem }()
	s.locks.Lock(itemID)
	defer s.locks.Unlock(itemID)

	still := func() bool {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		cur, ok := s.currentPath(ctx, itemID)
		if !ok || filepath.Clean(cur) != filepath.Clean(j.path) {
			return false
		}
		return fileExists(j.path)
	}
	if !still() {
		log.Printf("metaembed: item %d no longer at %s, skipping metadata embed", itemID, j.path)
		return
	}
	err := s.embedder.EmbedMetadataGuarded(context.Background(), j.path, j.req.Title, j.req.Artist, j.req.Year, j.req.SequenceNumber, j.req.SeasonNumber, still)
	switch {
	case err == nil:
	case errors.Is(err, downloader.ErrEmbedSkipped):
		log.Printf("metaembed: item %d changed during metadata embed of %s, discarded", itemID, j.path)
	default:
		log.Printf("metaembed: embedding metadata into %s failed: %v", j.path, err)
	}
}

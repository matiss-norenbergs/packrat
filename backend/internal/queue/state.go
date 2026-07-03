package queue

import (
	"sync"
	"time"

	"packrat/backend/internal/models"
)

// LiveProgress holds the in-memory, frequently-updated state for one active
// download. It is never persisted directly — the queue manager flushes a
// summary to the DB only on status change or completion, so the SQLite
// single writer never contends with per-second progress ticks (see the
// SQLite Concurrency engineering requirement).
type LiveProgress struct {
	DownloadID       int64
	Status           models.DownloadStatus
	Percent          float64
	SpeedBytesPerSec float64
	ETASeconds       int
	DownloadedBytes  int64
	TotalBytes       int64
	UpdatedAt        time.Time
}

// ProgressStore is a concurrency-safe map of live progress keyed by
// download ID, read by GET /downloads to merge with DB rows and by the
// WebSocket broadcast path.
type ProgressStore struct {
	mu   sync.RWMutex
	data map[int64]*LiveProgress
}

func NewProgressStore() *ProgressStore {
	return &ProgressStore{data: make(map[int64]*LiveProgress)}
}

func (s *ProgressStore) Set(id int64, p *LiveProgress) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[id] = p
}

func (s *ProgressStore) Get(id int64) (*LiveProgress, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.data[id]
	return p, ok
}

func (s *ProgressStore) Delete(id int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data, id)
}

func (s *ProgressStore) Snapshot() map[int64]*LiveProgress {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[int64]*LiveProgress, len(s.data))
	for k, v := range s.data {
		out[k] = v
	}
	return out
}

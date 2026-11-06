package version

import (
	"context"
	"sync"
	"time"
)

const (
	// LatestCacheTTL is how long a successful lookup is reused.
	LatestCacheTTL = time.Hour
	// LatestFailureTTL is how long a failed lookup is remembered before trying again.
	LatestFailureTTL = 5 * time.Minute
)

// Cache memoises a latest-version lookup. Concurrent callers that find it stale share one call to
// fetch, whose result (or error) is then served until it expires.
type Cache struct {
	fetch func(ctx context.Context) (string, error)
	now   func() time.Time

	mu       sync.Mutex
	value    string
	err      error
	expires  time.Time // zero until the first lookup finishes
	inflight *call
}

type call struct {
	done  chan struct{}
	value string
	err   error
}

// NewCache wraps fetch; pass nil for now to use the wall clock.
func NewCache(fetch func(ctx context.Context) (string, error), now func() time.Time) *Cache {
	if now == nil {
		now = time.Now
	}
	return &Cache{fetch: fetch, now: now}
}

// Get returns the cached lookup, refreshing it when it has expired. A caller whose ctx ends while
// waiting gets ctx.Err(); the shared lookup itself is not tied to any one caller's context.
func (c *Cache) Get(ctx context.Context) (string, error) {
	c.mu.Lock()
	if !c.expires.IsZero() && c.now().Before(c.expires) {
		v, err := c.value, c.err
		c.mu.Unlock()
		return v, err
	}
	cl := c.inflight
	if cl == nil {
		cl = &call{done: make(chan struct{})}
		c.inflight = cl
		go c.run(context.WithoutCancel(ctx), cl)
	}
	c.mu.Unlock()

	select {
	case <-cl.done:
		return cl.value, cl.err
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func (c *Cache) run(ctx context.Context, cl *call) {
	v, err := c.fetch(ctx)
	ttl := LatestCacheTTL
	if err != nil {
		ttl = LatestFailureTTL
	}
	c.mu.Lock()
	cl.value, cl.err = v, err
	c.value, c.err = v, err
	c.expires = c.now().Add(ttl)
	c.inflight = nil
	c.mu.Unlock()
	close(cl.done)
}

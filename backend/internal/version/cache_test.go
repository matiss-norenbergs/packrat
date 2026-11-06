package version

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *testClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}
func (c *testClock) advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func TestCacheSharesOneUpstreamCall(t *testing.T) {
	clock := &testClock{t: time.Unix(1_700_000_000, 0)}
	var calls atomic.Int32
	release := make(chan struct{})
	c := NewCache(func(context.Context) (string, error) {
		calls.Add(1)
		<-release // hold the lookup open so every caller piles onto it
		return "1.2.3", nil
	}, clock.now)

	const n = 100
	var wg sync.WaitGroup
	results := make([]string, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			v, err := c.Get(context.Background())
			if err != nil {
				t.Errorf("Get: %v", err)
			}
			results[i] = v
		}(i)
	}
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()

	for i, v := range results {
		if v != "1.2.3" {
			t.Fatalf("caller %d got %q", i, v)
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("%d upstream calls for %d concurrent requests, want 1", got, n)
	}
	// Later requests are served from the cache.
	for i := 0; i < 50; i++ {
		if _, err := c.Get(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("cached requests reached upstream: %d calls", got)
	}
}

func TestCacheExpiresAfterAnHour(t *testing.T) {
	clock := &testClock{t: time.Unix(1_700_000_000, 0)}
	var calls atomic.Int32
	c := NewCache(func(context.Context) (string, error) {
		return map[int32]string{1: "1.0.0", 2: "1.1.0"}[calls.Add(1)], nil
	}, clock.now)

	if v, _ := c.Get(context.Background()); v != "1.0.0" {
		t.Fatalf("first: %q", v)
	}
	clock.advance(LatestCacheTTL - time.Second)
	if v, _ := c.Get(context.Background()); v != "1.0.0" || calls.Load() != 1 {
		t.Fatalf("just before expiry: %q after %d calls", v, calls.Load())
	}
	clock.advance(2 * time.Second)
	if v, _ := c.Get(context.Background()); v != "1.1.0" || calls.Load() != 2 {
		t.Fatalf("after expiry: %q after %d calls", v, calls.Load())
	}
}

func TestCacheRemembersFailuresBriefly(t *testing.T) {
	clock := &testClock{t: time.Unix(1_700_000_000, 0)}
	var calls atomic.Int32
	boom := errors.New("github down")
	c := NewCache(func(context.Context) (string, error) {
		if calls.Add(1) == 1 {
			return "", boom
		}
		return "2.0.0", nil
	}, clock.now)

	if _, err := c.Get(context.Background()); !errors.Is(err, boom) {
		t.Fatalf("want the upstream error, got %v", err)
	}
	// Within the failure window the error is served without another call.
	clock.advance(LatestFailureTTL - time.Second)
	if _, err := c.Get(context.Background()); !errors.Is(err, boom) || calls.Load() != 1 {
		t.Fatalf("failure not cached: err=%v calls=%d", err, calls.Load())
	}
	// After it, the next request tries again — well before the success TTL.
	clock.advance(2 * time.Second)
	v, err := c.Get(context.Background())
	if err != nil || v != "2.0.0" || calls.Load() != 2 {
		t.Fatalf("retry after failure window: v=%q err=%v calls=%d", v, err, calls.Load())
	}
	if LatestFailureTTL >= LatestCacheTTL {
		t.Fatal("failures must be retried sooner than successes expire")
	}
}

func TestCacheCallerCancellationDoesNotFailOthers(t *testing.T) {
	var calls atomic.Int32
	release := make(chan struct{})
	c := NewCache(func(ctx context.Context) (string, error) {
		calls.Add(1)
		<-release
		return "3.0.0", ctx.Err()
	}, nil)

	cancelled, cancel := context.WithCancel(context.Background())
	first := make(chan error, 1)
	go func() { _, err := c.Get(cancelled); first <- err }()
	time.Sleep(30 * time.Millisecond)

	second := make(chan string, 1)
	go func() { v, _ := c.Get(context.Background()); second <- v }()
	time.Sleep(30 * time.Millisecond)

	cancel() // the first caller (which started the lookup) goes away
	if err := <-first; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled caller: %v", err)
	}
	close(release)
	if v := <-second; v != "3.0.0" {
		t.Fatalf("other caller got %q", v)
	}
	if calls.Load() != 1 {
		t.Fatalf("%d upstream calls", calls.Load())
	}
}

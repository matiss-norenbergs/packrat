package metaembed

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"packrat/backend/internal/itemlock"
)

type fakeEmbedder struct {
	mu      sync.Mutex
	titles  []string
	started chan string   // receives the title when a call begins
	release chan struct{} // closed/sent to let calls finish; nil = don't block
	cur     atomic.Int32
	max     atomic.Int32
	guard   []bool
}

func (f *fakeEmbedder) EmbedMetadataGuarded(_ context.Context, _ string, title string, _ *string, _, _, _ *int, beforeReplace func() bool) error {
	n := f.cur.Add(1)
	for {
		m := f.max.Load()
		if n <= m || f.max.CompareAndSwap(m, n) {
			break
		}
	}
	defer f.cur.Add(-1)
	if f.started != nil {
		f.started <- title
	}
	if f.release != nil {
		<-f.release
	}
	f.mu.Lock()
	f.titles = append(f.titles, title)
	f.mu.Unlock()
	if beforeReplace != nil {
		ok := beforeReplace()
		f.mu.Lock()
		f.guard = append(f.guard, ok)
		f.mu.Unlock()
	}
	return nil
}

func existingFile(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "a.mp4")
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func pathIs(p string) CurrentPathFunc {
	return func(context.Context, int64) (string, bool) { return p, true }
}

func TestCoalescesToOneRunningPlusLatestPending(t *testing.T) {
	f := &fakeEmbedder{started: make(chan string, 10), release: make(chan struct{})}
	p := existingFile(t)
	s := New(itemlock.New(), f, pathIs(p), 4)

	s.Submit(1, p, Request{Title: "t1"})
	<-f.started // t1 is running
	for _, title := range []string{"t2", "t3", "t4", "t5"} {
		s.Submit(1, p, Request{Title: title})
	}
	close(f.release)
	s.Wait()

	if got := f.titles; len(got) != 2 || got[0] != "t1" || got[1] != "t5" {
		t.Fatalf("runs = %v, want [t1 t5]", got)
	}
	if f.max.Load() != 1 {
		t.Fatalf("same-item runs overlapped (max %d)", f.max.Load())
	}
	if len(s.state) != 0 {
		t.Fatalf("state leaked: %d entries", len(s.state))
	}
}

func TestHoldsItemLockWhileRunning(t *testing.T) {
	locks := itemlock.New()
	f := &fakeEmbedder{started: make(chan string, 1), release: make(chan struct{})}
	p := existingFile(t)
	s := New(locks, f, pathIs(p), 4)

	s.Submit(7, p, Request{Title: "t"})
	<-f.started
	if locks.TryLock(7) {
		t.Fatal("item lock should be held during the embed")
	}
	if !locks.TryLock(8) {
		t.Fatal("other items must be unaffected")
	}
	locks.Unlock(8)
	close(f.release)
	s.Wait()
	if !locks.TryLock(7) {
		t.Fatal("lock not released after the embed")
	}
	locks.Unlock(7)
	if locks.Len() != 0 {
		t.Fatalf("lock entries left: %d", locks.Len())
	}
}

func TestGlobalConcurrencyBound(t *testing.T) {
	f := &fakeEmbedder{started: make(chan string, 20), release: make(chan struct{})}
	p := existingFile(t)
	s := New(itemlock.New(), f, pathIs(p), 2)

	for id := int64(1); id <= 8; id++ {
		s.Submit(id, p, Request{Title: "t"})
	}
	<-f.started
	<-f.started
	time.Sleep(50 * time.Millisecond) // give extra goroutines the chance to (wrongly) start
	if got := f.cur.Load(); got != 2 {
		t.Fatalf("running = %d, want 2", got)
	}
	close(f.release)
	s.Wait()
	if f.max.Load() > 2 {
		t.Fatalf("max concurrent = %d, want <= 2", f.max.Load())
	}
	if len(f.titles) != 8 {
		t.Fatalf("runs = %d, want 8", len(f.titles))
	}
}

func TestSkipsWhenItemGoneOrMoved(t *testing.T) {
	p := existingFile(t)
	for name, cur := range map[string]CurrentPathFunc{
		"row gone":   func(context.Context, int64) (string, bool) { return "", false },
		"path moved": pathIs(filepath.Join(filepath.Dir(p), "elsewhere.mp4")),
	} {
		f := &fakeEmbedder{}
		s := New(itemlock.New(), f, cur, 4)
		s.Submit(1, p, Request{Title: "t"})
		s.Wait()
		if len(f.titles) != 0 {
			t.Errorf("%s: embedder ran, want skipped", name)
		}
	}

	f := &fakeEmbedder{}
	s := New(itemlock.New(), f, pathIs(p), 4)
	os.Remove(p)
	s.Submit(1, p, Request{Title: "t"})
	s.Wait()
	if len(f.titles) != 0 {
		t.Error("file missing: embedder ran, want skipped")
	}
}

// The guard handed to the embedder re-checks at rename time.
func TestGuardReflectsChangeDuringRun(t *testing.T) {
	p := existingFile(t)
	var gone atomic.Bool
	cur := func(context.Context, int64) (string, bool) {
		if gone.Load() {
			return "", false
		}
		return p, true
	}
	f := &fakeEmbedder{started: make(chan string, 1), release: make(chan struct{})}
	s := New(itemlock.New(), f, cur, 4)
	s.Submit(1, p, Request{Title: "t"})
	<-f.started
	gone.Store(true) // the delete lands mid-remux
	close(f.release)
	s.Wait()
	if len(f.guard) != 1 || f.guard[0] {
		t.Fatalf("guard results = %v, want [false]", f.guard)
	}
}

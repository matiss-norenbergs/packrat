package imageproc

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func fakeGenerate(calls *int32, delay time.Duration) func(context.Context, string, string, string, int, int) error {
	return func(_ context.Context, _, _, dst string, _, _ int) error {
		atomic.AddInt32(calls, 1)
		time.Sleep(delay)
		return os.WriteFile(dst, []byte("webp"), 0o644)
	}
}

func testReq(mtime time.Time) ResizeRequest {
	return ResizeRequest{Root: "media", Path: "a/b.jpg", SrcAbs: "unused", Mtime: mtime, Size: 10, Width: 720}
}

func TestResizeKeyVariesByEveryField(t *testing.T) {
	base := testReq(time.Unix(100, 0))
	variants := []ResizeRequest{base}
	v := base
	v.Root = "images"
	variants = append(variants, v)
	v = base
	v.Path = "a/c.jpg"
	variants = append(variants, v)
	v = base
	v.Mtime = time.Unix(101, 0)
	variants = append(variants, v)
	v = base
	v.Size = 11
	variants = append(variants, v)
	v = base
	v.Width = 1080
	variants = append(variants, v)
	v = base
	v.Height = 405
	variants = append(variants, v)
	seen := map[string]bool{}
	for _, r := range variants {
		if seen[r.Key()] {
			t.Fatalf("duplicate key for %+v", r)
		}
		seen[r.Key()] = true
	}
}

func TestResizerCacheHitAndMtimeMiss(t *testing.T) {
	var calls int32
	r := NewResizer("ffmpeg", t.TempDir())
	r.generate = fakeGenerate(&calls, 0)
	ctx := context.Background()

	req := testReq(time.Unix(100, 0))
	p1, err := r.Get(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	p2, err := r.Get(ctx, req)
	if err != nil || p1 != p2 {
		t.Fatalf("second get: %v, %q vs %q", err, p1, p2)
	}
	if calls != 1 {
		t.Fatalf("cache hit regenerated: calls = %d", calls)
	}

	req.Mtime = time.Unix(200, 0)
	p3, err := r.Get(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if p3 == p1 || calls != 2 {
		t.Fatalf("mtime change should miss: same path=%v calls=%d", p3 == p1, calls)
	}
}

func TestResizerCoalescesConcurrentRequests(t *testing.T) {
	var calls int32
	r := NewResizer("ffmpeg", t.TempDir())
	r.generate = fakeGenerate(&calls, 150*time.Millisecond)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := r.Get(context.Background(), testReq(time.Unix(100, 0))); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if n := atomic.LoadInt32(&calls); n != 1 {
		t.Fatalf("expected 1 generation for 10 identical requests, got %d", n)
	}
}

func TestSweepCacheRemovesOnlyOldEntries(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	mk := func(name string, age time.Duration) string {
		p := filepath.Join(root, name[:2], name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		ts := now.Add(-age)
		if err := os.Chtimes(p, ts, ts); err != nil {
			t.Fatal(err)
		}
		return p
	}
	old := mk("aaold.webp", ResizeCacheMaxAge+time.Hour)
	fresh := mk("bbfresh.webp", ResizeCacheMaxAge-time.Hour)

	n, err := SweepCache(root, ResizeCacheMaxAge, now)
	if err != nil || n != 1 {
		t.Fatalf("sweep = %d, %v; want 1", n, err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Error("old entry should be removed")
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Error("fresh entry should remain")
	}
	if n, err := SweepCache(filepath.Join(root, "missing"), ResizeCacheMaxAge, now); err != nil || n != 0 {
		t.Errorf("missing root: %d, %v", n, err)
	}
}

func TestResizeWhitelists(t *testing.T) {
	for _, w := range []int{320, 480, 720, 1080, 1280, 1920} {
		if !IsAllowedResizeWidth(w) {
			t.Errorf("width %d should be allowed", w)
		}
	}
	for _, w := range []int{0, 100, 721, 4096, -320} {
		if IsAllowedResizeWidth(w) {
			t.Errorf("width %d should be rejected", w)
		}
	}
	for _, h := range []int{180, 270, 405, 720, 1080} {
		if !IsAllowedResizeHeight(h) {
			t.Errorf("height %d should be allowed", h)
		}
	}
	for _, h := range []int{0, 100, 1920} {
		if IsAllowedResizeHeight(h) {
			t.Errorf("height %d should be rejected", h)
		}
	}
}

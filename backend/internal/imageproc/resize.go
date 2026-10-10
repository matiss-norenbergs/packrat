package imageproc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Whitelists for live resizing (GET /api/image). Anything else is rejected
// rather than rounded, which bounds the number of cache variants.
var (
	ResizeWidths  = []int{320, 480, 720, 1080, 1280, 1920}
	ResizeHeights = []int{180, 270, 405, 720, 1080}
)

// ResizeCacheMaxAge is how long a cache entry may go unaccessed before the
// hourly sweep deletes it. The only place the age lives.
const ResizeCacheMaxAge = 7 * 24 * time.Hour

// maxConcurrentResizes bounds simultaneous ffmpeg resize processes — small on
// purpose, the app targets NAS/Pi hardware shared with downloads/transcodes.
const maxConcurrentResizes = 2

const cacheTempPrefix = ".tmp-"

// IsAllowedResizeWidth / IsAllowedResizeHeight report whitelist membership.
func IsAllowedResizeWidth(w int) bool  { return containsInt(ResizeWidths, w) }
func IsAllowedResizeHeight(h int) bool { return containsInt(ResizeHeights, h) }

func containsInt(list []int, v int) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// ResizeRequest identifies one resized variant of a source file. Mtime/Size
// come from the source's FileInfo so an in-place overwrite misses the cache.
type ResizeRequest struct {
	Root   string // "media" | "images"
	Path   string // relative path, as requested
	SrcAbs string
	Mtime  time.Time
	Size   int64
	Width  int
	Height int // 0 = no height cap
}

// Key returns the cache key (hex sha256) for the request.
func (r ResizeRequest) Key() string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%s\x00%d\x00%d\x00%d\x00%d",
		r.Root, r.Path, r.Mtime.UnixNano(), r.Size, r.Width, r.Height)))
	return hex.EncodeToString(h[:])
}

type resizeCall struct {
	done chan struct{}
	err  error
}

// Resizer produces cached WebP variants of images on demand, coalescing
// identical in-flight requests and bounding concurrent ffmpeg processes.
type Resizer struct {
	FFmpegPath string
	CacheRoot  string

	sem      chan struct{}
	mu       sync.Mutex
	inflight map[string]*resizeCall

	// generate is the encoder; tests replace it to avoid needing ffmpeg.
	generate func(ctx context.Context, ffmpegPath, src, dst string, w, h int) error
}

func NewResizer(ffmpegPath, cacheRoot string) *Resizer {
	return &Resizer{
		FFmpegPath: ffmpegPath,
		CacheRoot:  cacheRoot,
		sem:        make(chan struct{}, maxConcurrentResizes),
		inflight:   make(map[string]*resizeCall),
		generate:   GenerateWebPBox,
	}
}

// CachePath returns where the variant for key lives (sharded by the first
// two hex chars to keep directories small).
func (r *Resizer) CachePath(key string) string {
	return filepath.Join(r.CacheRoot, key[:2], key+".webp")
}

// Get returns the absolute path of the cached resized file for req,
// generating it if absent. Each hit/generation refreshes the file's mtime,
// which is the "last accessed" time the eviction sweep reads.
func (r *Resizer) Get(ctx context.Context, req ResizeRequest) (string, error) {
	key := req.Key()
	dst := r.CachePath(key)

	if touchIfExists(dst) {
		return dst, nil
	}

	r.mu.Lock()
	if call, ok := r.inflight[key]; ok {
		r.mu.Unlock()
		select {
		case <-call.done:
			return dst, call.err
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	call := &resizeCall{done: make(chan struct{})}
	r.inflight[key] = call
	r.mu.Unlock()

	// Detached from the leader's request context: followers share this
	// result, so one client disconnecting must not fail them all.
	call.err = r.build(context.WithoutCancel(ctx), req, dst)
	r.mu.Lock()
	delete(r.inflight, key)
	r.mu.Unlock()
	close(call.done)

	return dst, call.err
}

func (r *Resizer) build(ctx context.Context, req ResizeRequest, dst string) error {
	// Re-check under leadership: a previous leader may have finished between
	// our cache miss and registering as leader.
	if touchIfExists(dst) {
		return nil
	}

	r.sem <- struct{}{}
	defer func() { <-r.sem }()

	dir := filepath.Dir(dst)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating cache dir: %w", err)
	}
	tmp := filepath.Join(dir, cacheTempPrefix+uuid.NewString()+".webp")
	if err := r.generate(ctx, r.FFmpegPath, req.SrcAbs, tmp, req.Width, req.Height); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, dst); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("publishing cache file: %w", err)
	}
	return nil
}

func touchIfExists(path string) bool {
	if _, err := os.Stat(path); err != nil {
		return false
	}
	now := time.Now()
	_ = os.Chtimes(path, now, now)
	return true
}

// SweepCache deletes cache files whose last access (mtime) is older than
// maxAge relative to now, plus orphaned temp files of the same age. Returns
// the number removed. A missing cache root is not an error.
func SweepCache(cacheRoot string, maxAge time.Duration, now time.Time) (int, error) {
	cutoff := now.Add(-maxAge)
	removed := 0
	err := filepath.WalkDir(cacheRoot, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			return err
		}
		if d.IsDir() {
			return nil
		}
		name := d.Name()
		if !strings.HasSuffix(name, ".webp") {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if info.ModTime().Before(cutoff) {
			if os.Remove(p) == nil {
				removed++
			}
		}
		return nil
	})
	return removed, err
}

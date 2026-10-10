package api

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/imageproc"
)

type imageTestEnv struct {
	media, images, cache string
	router               *gin.Engine
}

func newImageTestEnv(t *testing.T) *imageTestEnv {
	t.Helper()
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not available")
	}
	gin.SetMode(gin.TestMode)
	env := &imageTestEnv{media: t.TempDir(), images: t.TempDir(), cache: t.TempDir()}
	r := gin.New()
	r.GET("/api/image", GetResizedImage(env.media, env.images, imageproc.NewResizer(ffmpeg, env.cache)))
	env.router = r
	return env
}

func writeJPEG(t *testing.T, path string, w, h int) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 128, 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func (e *imageTestEnv) get(query string, hdr ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/image?"+query, nil)
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	w := httptest.NewRecorder()
	e.router.ServeHTTP(w, req)
	return w
}

// webpSize reads the canvas size from a lossy (VP8), lossless (VP8L) or
// extended (VP8X) WebP.
func webpSize(t *testing.T, b []byte) (int, int) {
	t.Helper()
	if len(b) < 30 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WEBP" {
		t.Fatalf("not a WebP (%d bytes)", len(b))
	}
	switch string(b[12:16]) {
	case "VP8 ":
		return int(binary.LittleEndian.Uint16(b[26:28]) & 0x3fff), int(binary.LittleEndian.Uint16(b[28:30]) & 0x3fff)
	case "VP8L":
		bits := binary.LittleEndian.Uint32(b[21:25])
		return int(bits&0x3fff) + 1, int(bits>>14&0x3fff) + 1
	case "VP8X":
		w := int(b[24]) | int(b[25])<<8 | int(b[26])<<16
		h := int(b[27]) | int(b[28])<<8 | int(b[29])<<16
		return w + 1, h + 1
	}
	t.Fatalf("unknown WebP chunk %q", b[12:16])
	return 0, 0
}

func TestImageHandlerRejects(t *testing.T) {
	env := newImageTestEnv(t)
	writeJPEG(t, filepath.Join(env.media, "a.jpg"), 64, 48)
	if err := os.WriteFile(filepath.Join(env.media, "a.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name, query string
		want        int
	}{
		{"traversal", "root=media&path=../secret.jpg&w=320", 400},
		{"traversal nested", "root=media&path=a/../../x.jpg&w=320", 400},
		{"leading slash (400 on Linux, stays under root and 404s on Windows)", "root=media&path=/etc/passwd.jpg&w=320", 0},
		{"bad extension", "root=media&path=a.txt&w=320", 400},
		{"bad root", "root=other&path=a.jpg&w=320", 400},
		{"missing w", "root=media&path=a.jpg", 400},
		{"w not whitelisted", "root=media&path=a.jpg&w=321", 400},
		{"w non-numeric", "root=media&path=a.jpg&w=big", 400},
		{"h not whitelisted", "root=media&path=a.jpg&w=320&h=100", 400},
		{"missing source", "root=media&path=nope.jpg&w=320", 404},
		{"ok", "root=media&path=a.jpg&w=320", 200},
		{"ok with h", "root=media&path=a.jpg&w=320&h=180", 200},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := env.get(tc.query).Code
			if tc.want == 0 && (got == 400 || got == 404) {
				return
			}
			if got != tc.want {
				t.Fatalf("status = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestImageHandlerNoUpscale(t *testing.T) {
	env := newImageTestEnv(t)
	writeJPEG(t, filepath.Join(env.images, "small.jpg"), 200, 100)
	w := env.get("root=images&path=small.jpg&w=1920")
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "image/webp" {
		t.Errorf("content-type = %q", ct)
	}
	gw, gh := webpSize(t, w.Body.Bytes())
	if gw != 200 || gh != 100 {
		t.Fatalf("size = %dx%d, want 200x100 (no upscale)", gw, gh)
	}
}

func TestImageHandlerWidthDownscale(t *testing.T) {
	env := newImageTestEnv(t)
	writeJPEG(t, filepath.Join(env.media, "wide.jpg"), 960, 540)
	w := env.get("root=media&path=wide.jpg&w=320")
	gw, gh := webpSize(t, w.Body.Bytes())
	if gw != 320 || gh != 180 {
		t.Fatalf("size = %dx%d, want 320x180", gw, gh)
	}
}

func TestImageHandlerHeightCapPortrait(t *testing.T) {
	env := newImageTestEnv(t)
	writeJPEG(t, filepath.Join(env.media, "tall.jpg"), 600, 1200)

	// Width-only: 480 wide -> 960 tall.
	gw, gh := webpSize(t, env.get("root=media&path=tall.jpg&w=480").Body.Bytes())
	if gw != 480 || gh != 960 {
		t.Fatalf("width-only size = %dx%d, want 480x960", gw, gh)
	}
	// h=180 caps the height; aspect ratio kept, no crop/pad.
	gw, gh = webpSize(t, env.get("root=media&path=tall.jpg&w=480&h=180").Body.Bytes())
	if gw != 90 || gh != 180 {
		t.Fatalf("h-capped size = %dx%d, want 90x180", gw, gh)
	}
}

func TestImageHandlerCacheAndRevalidation(t *testing.T) {
	env := newImageTestEnv(t)
	src := filepath.Join(env.media, "c.jpg")
	writeJPEG(t, src, 400, 300)

	first := env.get("root=media&path=c.jpg&w=320")
	if first.Code != 200 {
		t.Fatalf("status %d", first.Code)
	}
	etag, lm := first.Header().Get("ETag"), first.Header().Get("Last-Modified")
	if etag == "" || lm == "" {
		t.Fatalf("missing validators: etag=%q last-modified=%q", etag, lm)
	}
	if cc := first.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("cache-control = %q", cc)
	}

	count := func() int {
		n := 0
		_ = filepath.WalkDir(env.cache, func(p string, d os.DirEntry, err error) error {
			if err == nil && !d.IsDir() {
				n++
			}
			return nil
		})
		return n
	}
	if count() != 1 {
		t.Fatalf("cache files = %d, want 1", count())
	}

	if got := env.get("root=media&path=c.jpg&w=320", "If-None-Match", etag).Code; got != http.StatusNotModified {
		t.Errorf("If-None-Match status = %d, want 304", got)
	}
	if got := env.get("root=media&path=c.jpg&w=320", "If-Modified-Since", lm).Code; got != http.StatusNotModified {
		t.Errorf("If-Modified-Since status = %d, want 304", got)
	}
	if count() != 1 {
		t.Fatalf("hit created a new file: %d", count())
	}

	// Overwrite in place with a different size -> new key, new ETag, new file.
	writeJPEG(t, src, 500, 300)
	second := env.get("root=media&path=c.jpg&w=320", "If-None-Match", etag)
	if second.Code != 200 {
		t.Fatalf("after overwrite status = %d, want 200", second.Code)
	}
	if second.Header().Get("ETag") == etag {
		t.Error("etag unchanged after source overwrite")
	}
	if count() != 2 {
		t.Fatalf("cache files = %d, want 2 after invalidation", count())
	}
}

package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestServeSPA_CacheControl(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"index.html":           "<html></html>",
		"favicon.svg":          "<svg/>",
		"assets/index-abc.js":  "var a=1;",
		"assets/index-abc.css": "a{}",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	r := gin.New()
	r.NoRoute(serveSPA(dir))

	cases := []struct{ path, want string }{
		{"/assets/index-abc.js", "public, max-age=31536000, immutable"},
		{"/assets/index-abc.css", "public, max-age=31536000, immutable"},
		{"/", "no-cache"},
		{"/library", "no-cache"},               // SPA fallback
		{"/assets/index-stale.js", "no-cache"}, // missing hashed file -> index.html, never immutable
		{"/favicon.svg", ""},                   // unhashed root file: left to Last-Modified revalidation
	}
	for _, tc := range cases {
		w := do(r, tc.path, nil)
		if w.Code != http.StatusOK {
			t.Errorf("%s: status %d", tc.path, w.Code)
		}
		if got := w.Header().Get("Cache-Control"); got != tc.want {
			t.Errorf("%s: Cache-Control = %q, want %q", tc.path, got, tc.want)
		}
	}
}

func TestServeSPA_UnknownNamespacedPaths404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.GET("/ws", func(c *gin.Context) { c.String(http.StatusOK, "ws") }) // a real route still wins
	r.NoRoute(serveSPA(dir))

	w := do(r, "/api/x", nil)
	if w.Code != http.StatusNotFound {
		t.Errorf("/api/x: status %d, want 404", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("/api/x: Content-Type %q, want JSON", ct)
	}
	if got := strings.TrimSpace(w.Body.String()); got != `{"error":"not found"}` {
		t.Errorf("/api/x: body %q", got)
	}
	for _, p := range []string{"/media-files/x", "/local-images/x", "/ws/x"} {
		w := do(r, p, nil)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", p, w.Code)
		}
		if strings.Contains(w.Body.String(), "<html") {
			t.Errorf("%s: served the SPA shell", p)
		}
	}
	if w := do(r, "/ws", nil); w.Code != http.StatusOK || w.Body.String() != "ws" {
		t.Errorf("/ws: registered route not reached: %d %q", w.Code, w.Body.String())
	}
	// Names that merely share a prefix are still client-side routes.
	if w := do(r, "/wsfoo", nil); w.Code != http.StatusOK || w.Header().Get("Cache-Control") != "no-cache" {
		t.Errorf("/wsfoo: status %d, Cache-Control %q", w.Code, w.Header().Get("Cache-Control"))
	}
}

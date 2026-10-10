package api

import (
	"net/http"
	"os"
	"path/filepath"
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

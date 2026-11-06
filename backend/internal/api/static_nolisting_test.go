package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestStaticMediaRoutesDoNotListDirectories(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sub", "a.txt"), []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Group("/media-files").StaticFS("/", noDirListingFS{http.Dir(root)})

	for _, p := range []string{"/media-files/", "/media-files/sub", "/media-files/sub/"} {
		if w := do(r, p, nil); w.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", p, w.Code)
		}
	}
	if w := do(r, "/media-files/sub/a.txt", nil); w.Code != http.StatusOK || w.Body.String() != "0123456789" {
		t.Fatalf("file: %d %q", w.Code, w.Body)
	}
	req := httptest.NewRequest(http.MethodGet, "/media-files/sub/a.txt", nil)
	req.Header.Set("Range", "bytes=2-4")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusPartialContent || w.Body.String() != "234" {
		t.Fatalf("range: %d %q", w.Code, w.Body)
	}
}

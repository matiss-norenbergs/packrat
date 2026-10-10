package api

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func bigJSON() string {
	return `{"items":[` + strings.Repeat(`{"title":"hello world","n":12345},`, 200) + `{}]}`
}

func newCompressRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Compress())
	r.GET("/api/big", func(c *gin.Context) {
		c.Data(http.StatusOK, "application/json; charset=utf-8", []byte(bigJSON()))
	})
	r.GET("/api/bigjson", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"items": strings.Split(strings.Repeat("hello,", 500), ",")})
	})
	r.GET("/api/small", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	r.GET("/api/image", func(c *gin.Context) {
		c.Data(http.StatusOK, "text/plain", []byte(strings.Repeat("a", 5000)))
	})
	r.GET("/media-files/x.txt", func(c *gin.Context) {
		c.Data(http.StatusOK, "text/plain", []byte(strings.Repeat("a", 5000)))
	})
	r.GET("/api/binary", func(c *gin.Context) {
		c.Data(http.StatusOK, "image/webp", bytes.Repeat([]byte{1, 2, 3, 4}, 2000))
	})
	r.GET("/api/encoded", func(c *gin.Context) {
		c.Header("Content-Encoding", "br")
		c.Data(http.StatusOK, "application/json", []byte(bigJSON()))
	})
	r.GET("/api/etag", func(c *gin.Context) {
		c.Header("ETag", `"abc"`)
		c.Data(http.StatusOK, "application/json", []byte(bigJSON()))
	})
	r.GET("/api/static", func(c *gin.Context) {
		// like serveSPA's c.File: http.ServeContent with a known length
		http.ServeContent(c.Writer, c.Request, "app.js", time.Unix(1700000000, 0), strings.NewReader(strings.Repeat("var a=1;\n", 2000)))
	})
	return r
}

func do(r http.Handler, path string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

var gz = map[string]string{"Accept-Encoding": "gzip"}

func gunzip(t *testing.T, b []byte) string {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("not gzip: %v", err)
	}
	out, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("gunzip: %v", err)
	}
	return string(out)
}

func TestCompress_GzipRoundTripAndVary(t *testing.T) {
	w := do(newCompressRouter(), "/api/big", gz)
	if got := w.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if !strings.Contains(w.Header().Get("Vary"), "Accept-Encoding") {
		t.Errorf("Vary = %q, want Accept-Encoding", w.Header().Get("Vary"))
	}
	if w.Header().Get("Content-Length") != "" {
		t.Errorf("Content-Length should be dropped, got %q", w.Header().Get("Content-Length"))
	}
	if w.Body.Len() >= len(bigJSON()) {
		t.Errorf("compressed %d >= original %d", w.Body.Len(), len(bigJSON()))
	}
	if got := gunzip(t, w.Body.Bytes()); got != bigJSON() {
		t.Error("decompressed body differs from original")
	}
}

func TestCompress_GinJSONRender(t *testing.T) {
	plain := do(newCompressRouter(), "/api/bigjson", nil)
	zipped := do(newCompressRouter(), "/api/bigjson", gz)
	if zipped.Header().Get("Content-Encoding") != "gzip" {
		t.Fatal("c.JSON response not compressed")
	}
	if gunzip(t, zipped.Body.Bytes()) != plain.Body.String() {
		t.Error("c.JSON body differs after decompress")
	}
}

func TestCompress_NoAcceptEncoding(t *testing.T) {
	w := do(newCompressRouter(), "/api/big", nil)
	if w.Header().Get("Content-Encoding") != "" {
		t.Error("compressed without Accept-Encoding")
	}
	if w.Body.String() != bigJSON() {
		t.Error("body altered")
	}
	// caches must still key on Accept-Encoding for a compressible resource
	if !strings.Contains(w.Header().Get("Vary"), "Accept-Encoding") {
		t.Errorf("Vary = %q, want Accept-Encoding", w.Header().Get("Vary"))
	}
}

func TestCompress_QZeroRefusesGzip(t *testing.T) {
	w := do(newCompressRouter(), "/api/big", map[string]string{"Accept-Encoding": "gzip;q=0, deflate"})
	if w.Header().Get("Content-Encoding") != "" {
		t.Error("gzip;q=0 must not be compressed")
	}
}

func TestCompress_SmallBodySkipped(t *testing.T) {
	w := do(newCompressRouter(), "/api/small", gz)
	if w.Header().Get("Content-Encoding") != "" {
		t.Error("tiny body was compressed")
	}
	if strings.TrimSpace(w.Body.String()) != `{"ok":true}` {
		t.Errorf("body = %q", w.Body.String())
	}
}

func TestCompress_RangeSkipped(t *testing.T) {
	w := do(newCompressRouter(), "/api/static", map[string]string{"Accept-Encoding": "gzip", "Range": "bytes=0-9"})
	if w.Header().Get("Content-Encoding") != "" {
		t.Error("Range response was compressed")
	}
	if w.Code != http.StatusPartialContent || w.Body.String() != "var a=1;\nv"[:10] {
		t.Errorf("code=%d body=%q", w.Code, w.Body.String())
	}
	if w.Header().Get("Content-Range") == "" {
		t.Error("Content-Range missing")
	}
}

func TestCompress_ExcludedPrefixes(t *testing.T) {
	for _, p := range []string{"/api/image", "/media-files/x.txt"} {
		w := do(newCompressRouter(), p, gz)
		if w.Header().Get("Content-Encoding") != "" || w.Header().Get("Vary") != "" {
			t.Errorf("%s was touched: enc=%q vary=%q", p, w.Header().Get("Content-Encoding"), w.Header().Get("Vary"))
		}
	}
}

func TestCompress_SkipPrefixMatching(t *testing.T) {
	cases := map[string]bool{
		"/api/image": true, "/api/image/x": true, "/media-files/a/b.mp4": true,
		"/local-images/a.jpg": true, "/ws": true,
		"/api/images-other": false, "/api/library": false, "/assets/index.js": false, "/websocket-docs": false,
	}
	for p, want := range cases {
		if got := hasSkipPrefix(p); got != want {
			t.Errorf("hasSkipPrefix(%q) = %v, want %v", p, got, want)
		}
	}
}

func TestCompress_NonCompressibleType(t *testing.T) {
	w := do(newCompressRouter(), "/api/binary", gz)
	if w.Header().Get("Content-Encoding") != "" {
		t.Error("image/webp was compressed")
	}
	if w.Body.Len() != 8000 {
		t.Errorf("body len = %d", w.Body.Len())
	}
}

func TestCompress_AlreadyEncoded(t *testing.T) {
	w := do(newCompressRouter(), "/api/encoded", gz)
	if got := w.Header().Get("Content-Encoding"); got != "br" {
		t.Errorf("Content-Encoding = %q, want br untouched", got)
	}
	if w.Body.String() != bigJSON() {
		t.Error("body altered")
	}
}

func TestCompress_WeakensETag(t *testing.T) {
	w := do(newCompressRouter(), "/api/etag", gz)
	if got := w.Header().Get("ETag"); got != `W/"abc"` {
		t.Errorf("ETag = %q, want W/\"abc\"", got)
	}
}

func TestCompress_ServeContentStatic(t *testing.T) {
	r := newCompressRouter()
	w := do(r, "/api/static", gz)
	if w.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("static not compressed; headers=%v", w.Header())
	}
	if w.Header().Get("Last-Modified") == "" {
		t.Error("Last-Modified lost")
	}
	if w.Header().Get("Accept-Ranges") != "" {
		t.Error("Accept-Ranges should be dropped on a gzip response")
	}
	if gunzip(t, w.Body.Bytes()) != strings.Repeat("var a=1;\n", 2000) {
		t.Error("static body differs")
	}

	// conditional request still yields an empty 304
	n := do(r, "/api/static", map[string]string{
		"Accept-Encoding":   "gzip",
		"If-Modified-Since": w.Header().Get("Last-Modified"),
	})
	if n.Code != http.StatusNotModified || n.Body.Len() != 0 || n.Header().Get("Content-Encoding") != "" {
		t.Errorf("304: code=%d bodyLen=%d enc=%q", n.Code, n.Body.Len(), n.Header().Get("Content-Encoding"))
	}
}

func TestAcceptsGzip(t *testing.T) {
	cases := map[string]bool{
		"": false, "gzip": true, "GZIP": true, "gzip, deflate, br": true, "br, gzip;q=0.5": true,
		"gzip;q=0": false, "gzip; q=0.0, br": false, "deflate": false, "*": false, "identity": false,
	}
	for in, want := range cases {
		if got := acceptsGzip(in); got != want {
			t.Errorf("acceptsGzip(%q) = %v, want %v", in, got, want)
		}
	}
}

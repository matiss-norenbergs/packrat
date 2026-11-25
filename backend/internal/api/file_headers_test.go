package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

const wantFilesCSP = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'"

func (e *bkEnv) fileReq(method, path string, hdr map[string]string) *httptest.ResponseRecorder {
	e.t.Helper()
	req := httptest.NewRequest(method, path, nil)
	for _, c := range e.cookies {
		req.AddCookie(c)
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, req)
	return w
}

func writeServedFile(t *testing.T, root, name, body string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func assertHardened(t *testing.T, label string, w *httptest.ResponseRecorder) {
	t.Helper()
	if got := w.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("%s: X-Content-Type-Options = %q", label, got)
	}
	if got := w.Header().Get("Content-Security-Policy"); got != wantFilesCSP {
		t.Errorf("%s: CSP = %q", label, got)
	}
}

func TestServedFiles_HeadersPerType(t *testing.T) {
	e := newBkEnv(t)
	html := "<html><script>fetch('/api/auth/status')</script></html>"
	svg := `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`
	files := map[string]string{
		"a.svg": svg, "a.html": html, "a.HTM": html, "noext": html, "a.nfo": "<movie/>", "a.json": "{}",
		"a.xml": "<x/>", "a.unknown": html, "dir.mp4/inner.html": html, "trailing.mp4.html": html, "dot.": html,
		"v.mp4": "mp4data", "v.MKV": "mkvdata", "a.m4a": "m4a", "a.mp3": "mp3", "s.vtt": "WEBVTT\n",
		"c.jpg": "jpg", "c.webp": "webp", "c.PNG": "png", "c.tif": "tif", "a.opus": "opus", "v.ts": "ts",
		"fake.mp4.svg": svg, // only the final extension counts
	}
	for name, body := range files {
		writeServedFile(t, e.mediaRoot, name, body)
		writeServedFile(t, e.imagesRoot, name, body)
	}
	inline := map[string]string{
		"v.mp4": "video/mp4", "v.MKV": "video/x-matroska", "a.m4a": "audio/mp4", "a.mp3": "audio/mpeg",
		"s.vtt": "text/vtt; charset=utf-8", "c.jpg": "image/jpeg", "c.webp": "image/webp", "c.PNG": "image/png",
		"c.tif": "image/tiff", "a.opus": "audio/ogg", "v.ts": "video/mp2t",
	}
	for _, prefix := range []string{"/media-files/", "/local-images/"} {
		for name := range files {
			want, isInline := inline[name]
			if !isInline {
				want = "application/octet-stream"
			}
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				label := method + " " + prefix + name
				w := e.fileReq(method, prefix+name, nil)
				if w.Code != http.StatusOK {
					t.Errorf("%s: status %d", label, w.Code)
					continue
				}
				assertHardened(t, label, w)
				if got := w.Header().Get("Content-Type"); got != want {
					t.Errorf("%s: Content-Type = %q, want %q", label, got, want)
				}
				disp := w.Header().Get("Content-Disposition")
				if isInline && disp != "" {
					t.Errorf("%s: unexpected Content-Disposition %q", label, disp)
				}
				if !isInline && disp != "attachment" {
					t.Errorf("%s: Content-Disposition = %q, want attachment", label, disp)
				}
				if got := w.Header().Get("Cache-Control"); got != "no-cache" {
					t.Errorf("%s: Cache-Control = %q", label, got)
				}
			}
		}
	}
}

func TestServedFiles_RangeConditionalAndMissing(t *testing.T) {
	e := newBkEnv(t)
	writeServedFile(t, e.mediaRoot, "v.mp4", "0123456789")
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(filepath.Join(e.mediaRoot, "v.mp4"), old, old); err != nil {
		t.Fatal(err)
	}
	for _, prefix := range []string{"/media-files", "/local-images"} {
		root := e.mediaRoot
		if prefix == "/local-images" {
			root = e.imagesRoot
			writeServedFile(t, root, "v.mp4", "0123456789")
		}

		w := e.fileReq(http.MethodGet, prefix+"/v.mp4", map[string]string{"Range": "bytes=2-5"})
		if w.Code != http.StatusPartialContent || w.Body.String() != "2345" {
			t.Fatalf("%s range: status %d body %q", prefix, w.Code, w.Body.String())
		}
		assertHardened(t, prefix+" 206", w)
		if w.Header().Get("Content-Type") != "video/mp4" || w.Header().Get("Content-Range") != "bytes 2-5/10" ||
			w.Header().Get("Accept-Ranges") != "bytes" || w.Header().Get("Content-Encoding") != "" {
			t.Errorf("%s 206 headers: %v", prefix, w.Header())
		}

		full := e.fileReq(http.MethodGet, prefix+"/v.mp4", nil)
		lm := full.Header().Get("Last-Modified")
		if lm == "" {
			t.Fatalf("%s: no Last-Modified", prefix)
		}
		w = e.fileReq(http.MethodGet, prefix+"/v.mp4", map[string]string{"If-Modified-Since": lm})
		if w.Code != http.StatusNotModified {
			t.Fatalf("%s 304: status %d", prefix, w.Code)
		}
		assertHardened(t, prefix+" 304", w)
		if w.Header().Get("Cache-Control") != "no-cache" {
			t.Errorf("%s 304: Cache-Control = %q", prefix, w.Header().Get("Cache-Control"))
		}

		for _, p := range []string{prefix + "/missing.mp4", prefix + "/missing.html", prefix + "/", prefix + "/sub/"} {
			w = e.fileReq(http.MethodGet, p, nil)
			if w.Code != http.StatusNotFound {
				t.Errorf("%s: status %d, want 404", p, w.Code)
			}
			assertHardened(t, p, w)
		}
	}
}

func TestServedFiles_UnauthenticatedStillHardened(t *testing.T) {
	e := newBkEnv(t)
	writeServedFile(t, e.mediaRoot, "a.html", "<script>1</script>")
	req := httptest.NewRequest(http.MethodGet, "/media-files/a.html", nil) // no cookies
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", w.Code)
	}
	assertHardened(t, "401", w)
	if strings.Contains(w.Body.String(), "<script>") {
		t.Error("served the file without a session")
	}
}

func TestFileExt(t *testing.T) {
	for in, want := range map[string]string{
		"/a/b.MP4": ".mp4", "/a/b.tar.gz": ".gz", "/a/.svg": ".svg", "/a/noext": "", "/a.b/noext": "", "/a/x.": ".",
	} {
		if got := fileExt(in); got != want {
			t.Errorf("fileExt(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBaselineHeaders_WholeApp(t *testing.T) {
	e := newBkEnv(t)
	check := func(label string, w *httptest.ResponseRecorder) {
		t.Helper()
		for k, want := range map[string]string{
			"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin",
		} {
			if got := w.Header().Get(k); got != want {
				t.Errorf("%s: %s = %q, want %q", label, k, got, want)
			}
		}
		if w.Header().Get("Content-Security-Policy") != "" && !strings.Contains(label, "files") {
			t.Errorf("%s: unexpected app-wide CSP", label)
		}
	}
	check("api 200", e.fileReq(http.MethodGet, "/api/health", nil))
	check("api 404", e.fileReq(http.MethodGet, "/api/nope", nil))
	check("api 401", httptestGet(e.r, "/api/library"))
}

func httptestGet(h http.Handler, p string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, p, nil))
	return w
}

func TestBaselineHeaders_CORSStillWorks(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(BaselineHeaders, CORS([]string{"http://tauri.localhost"}))
	r.GET("/x", func(c *gin.Context) { c.String(200, "ok") })
	r.OPTIONS("/x", func(c *gin.Context) { c.Status(200) })

	w := do(r, "/x", map[string]string{"Origin": "http://tauri.localhost"})
	if w.Header().Get("Access-Control-Allow-Origin") != "http://tauri.localhost" || w.Header().Get("X-Frame-Options") != "DENY" {
		t.Errorf("headers: %v", w.Header())
	}
	req := httptest.NewRequest(http.MethodOptions, "/x", nil)
	req.Header.Set("Origin", "http://tauri.localhost")
	req.Header.Set("Access-Control-Request-Method", "GET")
	pw := httptest.NewRecorder()
	r.ServeHTTP(pw, req)
	if pw.Code != http.StatusNoContent || pw.Header().Get("X-Content-Type-Options") != "nosniff" ||
		pw.Header().Get("Access-Control-Allow-Headers") == "" {
		t.Errorf("preflight: %d %v", pw.Code, pw.Header())
	}
}

// A real production build, if one exists (npm run build in frontend/), plus a
// synthetic copy of what Vite emits so the check also runs in CI without one.
func TestServeSPA_ContentTypesUnderNosniff(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	synthetic := map[string]string{
		"index.html": "<html></html>", "favicon.svg": "<svg/>", "icons.svg": "<svg/>",
		"assets/index-abc.js": "var a=1;", "assets/chunk-abc.mjs": "export {}", "assets/index-abc.css": "a{}",
		"assets/geist-latin-wght-normal-abc.woff2": "wOF2....",
		"assets/a.woff": "wOFF....", "assets/a.map": "{}", "manifest.webmanifest": "{}",
	}
	for name, body := range synthetic {
		writeServedFile(t, dir, name, body)
	}
	want := map[string]string{
		".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html",
		".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".map": "application/json",
		".webmanifest": "application/manifest+json",
	}
	run := func(root string, names []string) {
		r := gin.New()
		r.Use(BaselineHeaders)
		r.NoRoute(serveSPA(root))
		for _, name := range names {
			url := "/" + name
			if name == "index.html" {
				url = "/" // /index.html itself 301s to ./ (net/http ServeFile)
			}
			w := do(r, url, nil)
			if w.Code != http.StatusOK {
				t.Errorf("%s: status %d", name, w.Code)
				continue
			}
			ext := strings.ToLower(filepath.Ext(name))
			if got := w.Header().Get("Content-Type"); !strings.HasPrefix(got, want[ext]) {
				t.Errorf("%s: Content-Type %q, want %q", name, got, want[ext])
			}
			if w.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Errorf("%s: missing nosniff", name)
			}
		}
		// SPA fallback is HTML too.
		w := do(r, "/library/some-route", nil)
		if got := w.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
			t.Errorf("fallback Content-Type %q", got)
		}
	}
	var names []string
	for name := range synthetic {
		names = append(names, name)
	}
	run(dir, names)

	dist := filepath.Join("..", "..", "..", "frontend", "dist")
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		t.Log("no frontend/dist build; skipped the real-build half")
		return
	}
	var real []string
	_ = filepath.Walk(dist, func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			rel, _ := filepath.Rel(dist, p)
			if _, known := want[strings.ToLower(filepath.Ext(rel))]; known {
				real = append(real, filepath.ToSlash(rel))
			} else {
				t.Errorf("real build has %s, an extension serveSPA has no explicit type for", rel)
			}
		}
		return nil
	})
	run(dist, real)
}

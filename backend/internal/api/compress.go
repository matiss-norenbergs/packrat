package api

import (
	"bytes"
	"compress/gzip"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

const (
	// compressMinLength is the smallest body worth gzipping: below this the
	// 18-byte gzip framing plus the CPU cost beat the saving (and tiny JSON
	// like {"ok":true} would often get *bigger*).
	compressMinLength = 1024

	// compressLevel is gzip.BestSpeed (1): the app is meant to run on
	// NAS/Pi-class CPUs, and level 1 captures nearly all of the saving on
	// JS/CSS/JSON for a fraction of the CPU of the default level (numbers in
	// the PR that introduced this).
	compressLevel = gzip.BestSpeed
)

// compressSkipPrefixes are paths whose payload is already compressed media
// (or a WebSocket upgrade) and must be streamed byte-for-byte: video/audio
// are range-addressed, images are WebP/JPEG/PNG.
var compressSkipPrefixes = []string{
	"/media-files",
	"/local-images",
	"/api/image",
	"/ws",
}

var gzipWriterPool = sync.Pool{
	New: func() any {
		w, _ := gzip.NewWriterLevel(nil, compressLevel)
		return w
	},
}

// Compress gzips compressible responses (SPA assets and JSON API bodies)
// for clients that send Accept-Encoding: gzip.
//
// It never touches: skipped path prefixes, requests with a Range header
// (video seeking), HEAD requests, WebSocket upgrades, responses that already
// carry a Content-Encoding or Cache-Control: no-transform, non-200 statuses
// (304/206/204/errors-with-no-body), non-text content types, and bodies
// shorter than compressMinLength. A compressed response gets
// "Vary: Accept-Encoding", has Content-Length dropped, and any strong ETag
// weakened (the bytes on the wire differ from the stored representation).
func Compress() gin.HandlerFunc {
	return func(c *gin.Context) {
		r := c.Request
		if r.Method != http.MethodGet ||
			r.Header.Get("Range") != "" ||
			r.Header.Get("Upgrade") != "" ||
			hasSkipPrefix(r.URL.Path) {
			c.Next()
			return
		}

		cw := &compressWriter{
			ResponseWriter: c.Writer,
			acceptsGzip:    acceptsGzip(r.Header.Get("Accept-Encoding")),
		}
		c.Writer = cw
		c.Next()
		// Not deferred: if a handler panics, Recovery (outer) writes the 500
		// and the half-built body is dropped rather than flushed.
		cw.finish()
	}
}

func hasSkipPrefix(path string) bool {
	for _, p := range compressSkipPrefixes {
		if path == p || strings.HasPrefix(path, p+"/") {
			return true
		}
	}
	return false
}

// acceptsGzip reports whether an Accept-Encoding value allows gzip (an
// explicit gzip;q=0 is a refusal). "*" is deliberately not treated as an
// opt-in: every real browser and HTTP client names gzip explicitly.
func acceptsGzip(header string) bool {
	for _, part := range strings.Split(header, ",") {
		name, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if !strings.EqualFold(strings.TrimSpace(name), "gzip") {
			continue
		}
		params = strings.TrimSpace(params)
		if q, ok := strings.CutPrefix(params, "q="); ok {
			if v, err := strconv.ParseFloat(strings.TrimSpace(q), 64); err == nil && v <= 0 {
				return false
			}
		}
		return true
	}
	return false
}

// compressibleType reports whether a Content-Type is worth gzipping.
func compressibleType(contentType string) bool {
	mt, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return false
	}
	switch {
	case mt == "text/event-stream":
		return false // streaming; compressing would delay events
	case strings.HasPrefix(mt, "text/"):
		return true
	case mt == "application/json", mt == "application/javascript",
		mt == "application/xml", mt == "image/svg+xml",
		mt == "application/manifest+json":
		return true
	case strings.HasSuffix(mt, "+json"), strings.HasSuffix(mt, "+xml"):
		return true
	}
	return false
}

type compressState int

const (
	statePending    compressState = iota // nothing written yet / still buffering
	statePassthru                        // decided: write straight through
	stateCompressed                      // decided: writing through gzip
)

// compressWriter defers the compress/don't decision until it has seen the
// status, headers and first compressMinLength bytes of the body, buffering
// until then.
type compressWriter struct {
	gin.ResponseWriter
	acceptsGzip bool
	state       compressState
	buf         bytes.Buffer
	gz          *gzip.Writer
}

func (w *compressWriter) Write(p []byte) (int, error) {
	switch w.state {
	case statePassthru:
		return w.ResponseWriter.Write(p)
	case stateCompressed:
		return w.gz.Write(p)
	}

	// A known Content-Length lets us decide on the first write instead of
	// buffering (static files, ServeContent).
	if cl, err := strconv.ParseInt(w.Header().Get("Content-Length"), 10, 64); err == nil {
		if cl < compressMinLength {
			w.state = statePassthru
		} else {
			w.decide(p)
		}
		if w.state == statePassthru {
			return w.ResponseWriter.Write(p)
		}
		return w.gz.Write(p)
	}

	w.buf.Write(p)
	if w.buf.Len() >= compressMinLength {
		w.decide(w.buf.Bytes())
		w.drain()
	}
	return len(p), nil
}

func (w *compressWriter) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}

// WriteHeaderNow is called by gin internals (e.g. c.Status with no body);
// with nothing buffered it decides pass-through.
func (w *compressWriter) WriteHeaderNow() {
	if w.state == statePending && w.buf.Len() == 0 {
		w.state = statePassthru
	}
	if w.state != stateCompressed {
		w.ResponseWriter.WriteHeaderNow()
	}
}

// Flush forces a decision (streaming handlers) and flushes through.
func (w *compressWriter) Flush() {
	if w.state == statePending {
		w.decide(w.buf.Bytes())
		w.drain()
	}
	if w.state == stateCompressed {
		_ = w.gz.Flush()
	}
	w.ResponseWriter.Flush()
}

// decide picks compressed or passthru from the headers and the first bytes
// of body (sniffed when the handler set no Content-Type).
func (w *compressWriter) decide(first []byte) {
	h := w.Header()
	status := w.ResponseWriter.Status()

	ct := h.Get("Content-Type")
	if ct == "" && len(first) > 0 {
		ct = http.DetectContentType(first)
		h.Set("Content-Type", ct)
	}

	if !w.acceptsGzip || status != http.StatusOK ||
		h.Get("Content-Encoding") != "" ||
		strings.Contains(strings.ToLower(h.Get("Cache-Control")), "no-transform") ||
		!compressibleType(ct) {
		if compressibleType(ct) && status == http.StatusOK && h.Get("Content-Encoding") == "" {
			addVary(h)
		}
		w.state = statePassthru
		return
	}

	addVary(h)
	h.Set("Content-Encoding", "gzip")
	h.Del("Content-Length")
	h.Del("Accept-Ranges") // ranges address the identity bytes, not the gzip stream
	if etag := h.Get("ETag"); etag != "" && !strings.HasPrefix(etag, "W/") {
		h.Set("ETag", "W/"+etag)
	}

	gz := gzipWriterPool.Get().(*gzip.Writer)
	gz.Reset(w.ResponseWriter)
	w.gz = gz
	w.state = stateCompressed
}

// drain writes whatever was buffered through the decided path.
func (w *compressWriter) drain() {
	if w.buf.Len() == 0 {
		return
	}
	if w.state == stateCompressed {
		_, _ = w.gz.Write(w.buf.Bytes())
	} else {
		_, _ = w.ResponseWriter.Write(w.buf.Bytes())
	}
	w.buf.Reset()
}

// finish runs after the handler chain: it flushes a still-buffered small
// body uncompressed and closes the gzip stream.
func (w *compressWriter) finish() {
	if w.state == statePending {
		if w.buf.Len() > 0 {
			// Short body: serve as-is (net/http adds Content-Length).
			if compressibleType(w.Header().Get("Content-Type")) {
				addVary(w.Header())
			}
			w.state = statePassthru
			w.drain()
		}
		return
	}
	if w.state == stateCompressed {
		_ = w.gz.Close()
		w.gz.Reset(nil)
		gzipWriterPool.Put(w.gz)
		w.gz = nil
	}
}

func addVary(h http.Header) {
	for _, v := range h.Values("Vary") {
		for _, part := range strings.Split(v, ",") {
			p := strings.TrimSpace(part)
			if p == "*" || strings.EqualFold(p, "Accept-Encoding") {
				return
			}
		}
	}
	h.Add("Vary", "Accept-Encoding")
}

package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// postDeclaring sends a (tiny) body whose declared Content-Length is n: the
// size check runs on the declared length, so no n-byte body has to exist.
func (e *bkEnv) postDeclaring(path string, n int64) *httptest.ResponseRecorder {
	e.t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api"+path, strings.NewReader(`{}`))
	req.ContentLength = n
	req.Header.Set("Content-Type", "application/json")
	for _, c := range e.cookies {
		req.AddCookie(c)
	}
	req.Header.Set("X-CSRF-Token", e.csrf)
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, req)
	return w
}

// The backup import/preview routes accept bodies above the global 50 MB cap, up
// to maxBackupImportBodyBytes; one byte more is 413 with a clear message. A
// body at or under the limit passes the size check (the handler then answers
// 400 because "{}" is not a backup).
func TestBackupImportBodyLimit(t *testing.T) {
	if maxRequestBodyBytes != 50<<20 {
		t.Fatalf("the global request limit changed to %d", maxRequestBodyBytes)
	}
	e := newBkEnv(t)
	for _, ep := range importEndpoints {
		t.Run(ep.path, func(t *testing.T) {
			for _, n := range []int64{maxRequestBodyBytes + 1, 100 << 20, maxBackupImportBodyBytes} {
				w := e.postDeclaring(ep.path, n)
				if w.Code == http.StatusRequestEntityTooLarge {
					t.Errorf("declared %d bytes: refused with 413: %s", n, w.Body)
				}
			}
			w := e.postDeclaring(ep.path, maxBackupImportBodyBytes+1)
			if w.Code != http.StatusRequestEntityTooLarge {
				t.Fatalf("limit+1: status %d, want 413: %s", w.Code, w.Body)
			}
			if !strings.Contains(w.Body.String(), "The backup file is too large (the limit is 128 MB).") {
				t.Errorf("message = %s", w.Body)
			}
		})
	}
}

// Every other route keeps the global cap: it reads at most maxRequestBodyBytes.
func TestOtherRoutesKeepTheGlobalBodyLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(limitRequestBody)
	var read int64
	var readErr error
	r.POST("/x", func(c *gin.Context) {
		read, readErr = io.Copy(io.Discard, c.Request.Body)
		c.Status(http.StatusNoContent)
	})
	req := httptest.NewRequest(http.MethodPost, "/x", io.LimitReader(zeroReader{}, maxRequestBodyBytes+10))
	req.ContentLength = -1 // chunked
	r.ServeHTTP(httptest.NewRecorder(), req)
	if readErr == nil || read != maxRequestBodyBytes {
		t.Fatalf("read %d bytes, err %v: the global cap should cut the body at %d", read, readErr, maxRequestBodyBytes)
	}
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = ' '
	}
	return len(p), nil
}

// A body whose length is not declared (chunked) is cut off while it is read:
// 413 over the limit, accepted at it. Uses a small limit on a mini router; the
// middleware and the binding helper are the ones the real routes use.
func TestAllowLargeBodyChunked(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const limit = 1000
	r := gin.New()
	r.Use(limitRequestBody)
	r.POST("/up", allowLargeBody(limit), func(c *gin.Context) {
		var req BackupImportRequest
		if !bindBackupImport(c, &req) {
			return
		}
		c.JSON(http.StatusOK, gin.H{"len": len(req.Data)})
	})
	send := func(dataLen int) *httptest.ResponseRecorder {
		body := `{"data":"` + strings.Repeat("a", dataLen) + `"}`
		req := httptest.NewRequest(http.MethodPost, "/up", io.NopCloser(strings.NewReader(body)))
		req.ContentLength = -1
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	overhead := len(`{"data":""}`)
	if w := send(limit - overhead); w.Code != http.StatusOK {
		t.Fatalf("body of exactly the limit: status %d %s", w.Code, w.Body)
	}
	w := send(limit - overhead + 1)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("one byte over: status %d, want 413: %s", w.Code, w.Body)
	}
	if !strings.Contains(w.Body.String(), "too large") {
		t.Errorf("message = %s", w.Body)
	}
}

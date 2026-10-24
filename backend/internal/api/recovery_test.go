package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// panicLog runs a panicking handler through mw (with the given gin mode) and returns what the
// recovery wrote to the log plus the response.
func panicLog(t *testing.T, mode string, mw func(out *bytes.Buffer) gin.HandlerFunc) (string, *httptest.ResponseRecorder) {
	t.Helper()
	prev := gin.Mode()
	gin.SetMode(mode)
	t.Cleanup(func() { gin.SetMode(prev) })

	var buf bytes.Buffer
	r := gin.New()
	r.Use(mw(&buf))
	r.GET("/x", func(c *gin.Context) { panic("boom") })

	req := httptest.NewRequest(http.MethodGet, "/x?token=SECRET&a=b", nil)
	req.Header.Set("Authorization", "Bearer SECRET2")
	req.Header.Set("Cookie", "packrat_session=SECRET3; packrat_csrf=SECRET4")
	req.Header.Set("X-CSRF-Token", "SECRET5")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return buf.String(), w
}

func TestRecovery_RedactsSecrets(t *testing.T) {
	for _, mode := range []string{gin.DebugMode, gin.ReleaseMode} {
		t.Run(mode, func(t *testing.T) {
			out, w := panicLog(t, mode, func(buf *bytes.Buffer) gin.HandlerFunc { return recoveryWriter(buf) })
			if w.Code != http.StatusInternalServerError || w.Body.Len() != 0 {
				t.Fatalf("response = %d %q, want empty 500", w.Code, w.Body.String())
			}
			if !strings.Contains(out, "panic recovered") || !strings.Contains(out, "boom") {
				t.Fatalf("panic not logged: %q", out)
			}
			for _, s := range []string{"SECRET", "SECRET2", "SECRET3", "SECRET4", "SECRET5"} {
				if strings.Contains(out, s) {
					t.Errorf("log leaks %s:\n%s", s, out)
				}
			}
		})
	}
}

func TestRedactDump(t *testing.T) {
	in := "GET /x?token=T1&a=b HTTP/1.1\r\nauthorization: Bearer B\r\nCookie: s=C\r\nX-Csrf-Token: X\r\nHost: h\r\n"
	got := redactDump(in)
	for _, s := range []string{"T1", "Bearer B", "s=C", ": X"} {
		if strings.Contains(got, s) {
			t.Errorf("still contains %q: %q", s, got)
		}
	}
	if !strings.Contains(got, "a=b") || !strings.Contains(got, "Host: h") {
		t.Errorf("over-redacted: %q", got)
	}
}

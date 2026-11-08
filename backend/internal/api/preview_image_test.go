package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/repository"
)

func previewRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	conn := openMigratedTestDB(t)
	r := gin.New()
	r.GET("/preview", PreviewImage(repository.NewSettingsRepo(conn)))
	return r
}

func TestPreviewImageKind(t *testing.T) {
	var hits atomic.Int32
	// httptest servers listen on 127.0.0.1, a private target.
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "image/png")
		io.WriteString(w, "pngdata")
	}))
	defer target.Close()
	r := previewRouter(t)

	get := func(query string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/preview?url="+url.QueryEscape(target.URL+"/secret?token=abc")+query, nil))
		return w
	}

	for _, q := range []string{"", "&kind=image"} {
		w := get(q)
		if w.Code != http.StatusOK || w.Body.String() != "pngdata" {
			t.Errorf("kind %q: code %d body %q, want typed LAN image to work", q, w.Code, w.Body.String())
		}
	}
	if hits.Load() != 2 {
		t.Fatalf("hits = %d, want 2", hits.Load())
	}

	w := get("&kind=thumbnail")
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("thumbnail: code %d, want 422", w.Code)
	}
	if body := w.Body.String(); strings.Contains(body, "token") || strings.Contains(body, "127.0.0.1") || !strings.Contains(body, "refused") {
		t.Fatalf("thumbnail error body = %s", body)
	}
	if hits.Load() != 2 {
		t.Fatal("loopback server contacted in thumbnail mode")
	}

	if w := get("&kind=bogus"); w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "kind") {
		t.Fatalf("bogus kind: code %d body %s", w.Code, w.Body.String())
	}
}

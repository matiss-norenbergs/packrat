package api

import (
	"net/http"
	"testing"
)

func TestImportRejectsNonHTTPOriginalURL(t *testing.T) {
	e := newCleanupEnv(t)
	h := CreateImport(e.mediaRoot, e.imagesRoot, e.library, nil, nil, "", nil)
	w := e.do(t, h, http.MethodPost, "/import", "/import", `{"path":"a.mp4","originalUrl":"-example"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", w.Code, w.Body)
	}
}

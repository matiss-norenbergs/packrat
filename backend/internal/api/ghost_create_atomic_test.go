package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/repository"
)

// A tagging failure while creating a ghost must roll the row back, so a retry
// makes exactly one ghost instead of leaving a duplicate behind.
func TestCreateGhostTaggingFailureLeavesNoGhost(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := newCleanupEnv(t)
	r := gin.New()
	r.POST("/ghost", CreateGhostLibraryItem(e.library, e.imagesRoot, nil, repository.NewTagsRepo(e.conn), e.responder()))

	post := func() int {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/ghost", bytes.NewBufferString(`{"title":"Ghost","mediaType":"video","tags":["a","b"]}`))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		return w.Code
	}
	count := func() int {
		var n int
		if err := e.conn.QueryRow(`SELECT COUNT(*) FROM library`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	if _, err := e.conn.Exec(`CREATE TRIGGER fail_tagging BEFORE INSERT ON library_tags BEGIN SELECT RAISE(ABORT, 'boom'); END`); err != nil {
		t.Fatal(err)
	}
	if got := post(); got != http.StatusInternalServerError {
		t.Fatalf("tagging failure: status %d, want 500", got)
	}
	if n := count(); n != 0 {
		t.Fatalf("%d library rows after a failed create, want 0", n)
	}

	if _, err := e.conn.Exec(`DROP TRIGGER fail_tagging`); err != nil {
		t.Fatal(err)
	}
	if got := post(); got != http.StatusCreated {
		t.Fatalf("retry: status %d, want 201", got)
	}
	if n := count(); n != 1 {
		t.Fatalf("%d library rows after the retry, want exactly 1", n)
	}
	var tags int
	if err := e.conn.QueryRow(`SELECT COUNT(*) FROM library_tags`).Scan(&tags); err != nil || tags != 2 {
		t.Fatalf("library_tags rows = %d (err %v), want 2", tags, err)
	}
}

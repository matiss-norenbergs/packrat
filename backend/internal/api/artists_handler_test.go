package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/repository"
)

func newArtistsRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	f := newPrivacyFixture(t)
	repo := repository.NewArtistsRepo(f.conn)
	r := gin.New()
	r.GET("/artists", ListArtists(repo))
	r.POST("/artists", CreateArtist(repo))
	r.PATCH("/artists/:id", UpdateArtist(repo))
	return r
}

func artistsDo(r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func artistFlag(t *testing.T, r *gin.Engine, id int64) bool {
	t.Helper()
	w := artistsDo(r, "GET", "/artists", "")
	if w.Code != http.StatusOK {
		t.Fatalf("list: %d", w.Code)
	}
	var list []ArtistResponse
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	for _, a := range list {
		if a.ID == id {
			return a.IsPrivate
		}
	}
	t.Fatalf("artist %d not in list", id)
	return false
}

func createArtist(t *testing.T, r *gin.Engine, body string) int64 {
	t.Helper()
	w := artistsDo(r, "POST", "/artists", body)
	if w.Code != http.StatusCreated {
		t.Fatalf("create %s: %d %s", body, w.Code, w.Body.String())
	}
	var out struct{ ID int64 }
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.ID
}

func TestArtistsHandler_IsPrivate(t *testing.T) {
	r := newArtistsRouter(t)

	pub := createArtist(t, r, `{"name":"Public"}`)
	priv := createArtist(t, r, `{"name":"Private","isPrivate":true}`)
	if artistFlag(t, r, pub) {
		t.Errorf("create without isPrivate should be public")
	}
	if !artistFlag(t, r, priv) {
		t.Errorf("create with isPrivate=true should be private")
	}

	patch := func(id int64, body string) {
		t.Helper()
		if w := artistsDo(r, "PATCH", "/artists/"+strconv.FormatInt(id, 10), body); w.Code != http.StatusNoContent {
			t.Fatalf("patch %s: %d %s", body, w.Code, w.Body.String())
		}
	}

	patch(pub, `{"name":"Public","isPrivate":true}`)
	if !artistFlag(t, r, pub) {
		t.Errorf("update should set the flag")
	}
	patch(pub, `{"name":"Public renamed"}`)
	if !artistFlag(t, r, pub) {
		t.Errorf("update with isPrivate omitted must keep the flag")
	}
	patch(pub, `{"name":"Public renamed","isPrivate":false}`)
	if artistFlag(t, r, pub) {
		t.Errorf("update should clear the flag")
	}
}

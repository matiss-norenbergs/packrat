package api

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

type patchFixture struct {
	t    *testing.T
	repo *repository.CollectionsRepo
	r    *gin.Engine
	id   int64
}

// newPatchFixture mounts only UpdateCollection and seeds one fully populated
// collection (every optional field set) plus a sibling named "Other".
func newPatchFixture(t *testing.T) *patchFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	conn := openMigratedTestDB(t)
	repo := repository.NewCollectionsRepo(conn)
	mgr := queue.NewDownloadManager(t.TempDir(), t.TempDir(), "", nil, nil, nil, repo, nil, nil, nil, nil, nil, nil, nil, queue.NewProgressStore(), nil)
	artists := repository.NewArtistsRepo(conn)
	artist, err := artists.CreateWithPrivacy(context.Background(), "A", nil, false)
	if err != nil {
		t.Fatal(err)
	}
	id, err := repo.Create(context.Background(), &models.Collection{
		Name: "Show", RootPath: "Show", DefaultQuality: "720p", DefaultDownloadType: "audio", FilenameTemplate: "{artist}/{title}",
		IsPrivate: true, BrowseAsShow: true, JellyfinLibrary: ptr("jf"), SeasonNumber: ptr(2), Year: ptr(1999),
		SequenceMin: ptr(5), SequenceMax: ptr(10), ArtistID: &artist.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Create(context.Background(), &models.Collection{Name: "Other", RootPath: "Other", DefaultQuality: "best", DefaultDownloadType: "video"}); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.PATCH("/api/collections/:id", UpdateCollection(repo, mgr))
	return &patchFixture{t: t, repo: repo, r: r, id: id}
}

func (f *patchFixture) patch(id int64, body string) int {
	f.t.Helper()
	req := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/collections/%d", id), bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	f.r.ServeHTTP(w, req)
	return w.Code
}

func (f *patchFixture) get() *models.Collection {
	f.t.Helper()
	c, err := f.repo.Get(context.Background(), f.id)
	if err != nil {
		f.t.Fatal(err)
	}
	return c
}

func eqPtr[T comparable](a, b *T) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func TestUpdateCollectionMerge(t *testing.T) {
	const base = `"name":"Show","rootPath":"Show"`
	tests := []struct {
		name   string
		body   string
		status int
		check  func(t *testing.T, c *models.Collection)
	}{
		{"only required: everything else kept", `{` + base + `}`, 204, func(t *testing.T, c *models.Collection) {
			if !c.IsPrivate || !c.BrowseAsShow || c.DefaultQuality != "720p" || c.DefaultDownloadType != "audio" || c.FilenameTemplate != "{artist}/{title}" {
				t.Errorf("scalar fields changed: %+v", c)
			}
			if c.JellyfinLibrary == nil || c.SeasonNumber == nil || c.Year == nil || c.SequenceMin == nil || c.SequenceMax == nil || c.ArtistID == nil {
				t.Errorf("nullable fields cleared: %+v", c)
			}
		}},
		{"name change only", `{"name":"Renamed","rootPath":"Show"}`, 204, func(t *testing.T, c *models.Collection) {
			if c.Name != "Renamed" || !c.IsPrivate {
				t.Errorf("%+v", c)
			}
		}},
		{"explicit false clears bools", `{` + base + `,"isPrivate":false,"browseAsShow":false}`, 204, func(t *testing.T, c *models.Collection) {
			if c.IsPrivate || c.BrowseAsShow {
				t.Errorf("bools not cleared: %+v", c)
			}
		}},
		{"null clears every nullable field", `{` + base + `,"jellyfinLibraryId":null,"seasonNumber":null,"year":null,"sequenceMin":null,"sequenceMax":null,"artistId":null}`, 204, func(t *testing.T, c *models.Collection) {
			if c.JellyfinLibrary != nil || c.SeasonNumber != nil || c.Year != nil || c.SequenceMin != nil || c.SequenceMax != nil || c.ArtistID != nil {
				t.Errorf("not cleared: %+v", c)
			}
		}},
		{"values set nullable fields", `{` + base + `,"jellyfinLibraryId":"x","seasonNumber":3,"year":2001,"sequenceMin":1,"sequenceMax":99}`, 204, func(t *testing.T, c *models.Collection) {
			if !eqPtr(c.JellyfinLibrary, ptr("x")) || !eqPtr(c.SeasonNumber, ptr(3)) || !eqPtr(c.Year, ptr(2001)) || !eqPtr(c.SequenceMin, ptr(1)) || !eqPtr(c.SequenceMax, ptr(99)) {
				t.Errorf("%+v", c)
			}
			if c.ArtistID == nil {
				t.Error("omitted artistId was cleared")
			}
		}},
		{"enums set", `{` + base + `,"defaultQuality":"1080p","defaultDownloadType":"image"}`, 204, func(t *testing.T, c *models.Collection) {
			if c.DefaultQuality != "1080p" || c.DefaultDownloadType != "image" {
				t.Errorf("%+v", c)
			}
		}},
		{"explicit empty strings fall back to defaults", `{` + base + `,"defaultQuality":"","defaultDownloadType":"","filenameTemplate":""}`, 204, func(t *testing.T, c *models.Collection) {
			if c.DefaultQuality != "best" || c.DefaultDownloadType != "video" || c.FilenameTemplate != "{title}" {
				t.Errorf("%+v", c)
			}
		}},
		{"invalid quality rejected", `{` + base + `,"defaultQuality":"bogus"}`, 400, nil},
		{"invalid type rejected", `{` + base + `,"defaultDownloadType":"bogus"}`, 400, nil},
		{"wrong json type rejected", `{` + base + `,"seasonNumber":"x"}`, 400, nil},
		{"full body as the dialog sends it", `{"name":"Show","rootPath":"Show","defaultQuality":"best","defaultDownloadType":"video","isPrivate":false,"jellyfinLibraryId":null,"seasonNumber":null,"year":null,"sequenceMin":null,"sequenceMax":null,"artistId":null,"filenameTemplate":"{title}","browseAsShow":false}`, 204, func(t *testing.T, c *models.Collection) {
			if c.IsPrivate || c.BrowseAsShow || c.DefaultQuality != "best" || c.DefaultDownloadType != "video" || c.FilenameTemplate != "{title}" ||
				c.JellyfinLibrary != nil || c.SeasonNumber != nil || c.Year != nil || c.SequenceMin != nil || c.SequenceMax != nil || c.ArtistID != nil {
				t.Errorf("full body did not replace: %+v", c)
			}
		}},
		{"sequenceMax below stored min rejected", `{` + base + `,"sequenceMax":3}`, 400, nil},
		{"sequenceMin above stored max rejected", `{` + base + `,"sequenceMin":11}`, 400, nil},
		{"sequenceMax below stored min allowed when min cleared", `{` + base + `,"sequenceMin":null,"sequenceMax":3}`, 204, func(t *testing.T, c *models.Collection) {
			if c.SequenceMin != nil || !eqPtr(c.SequenceMax, ptr(3)) {
				t.Errorf("%+v", c)
			}
		}},
		{"equal min and max allowed", `{` + base + `,"sequenceMin":10}`, 204, nil},
		{"out of range number rejected", `{` + base + `,"sequenceMax":2000000}`, 400, nil},
		{"name required", `{"rootPath":"Show"}`, 400, nil},
		{"rootPath required", `{"name":"Show"}`, 400, nil},
		{"duplicate name conflicts", `{"name":"Other","rootPath":"Show"}`, 409, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newPatchFixture(t)
			if got := f.patch(f.id, tt.body); got != tt.status {
				t.Fatalf("status = %d, want %d", got, tt.status)
			}
			if tt.check != nil {
				tt.check(t, f.get())
			}
		})
	}
}

func TestUpdateCollectionRejectedPatchChangesNothing(t *testing.T) {
	f := newPatchFixture(t)
	if got := f.patch(f.id, `{"name":"Show","rootPath":"Show","isPrivate":false,"sequenceMax":3}`); got != 400 {
		t.Fatalf("status = %d", got)
	}
	if c := f.get(); !c.IsPrivate || !eqPtr(c.SequenceMax, ptr(10)) {
		t.Fatalf("rejected patch was partially applied: %+v", c)
	}
}

func TestUpdateCollectionStoredInvertedRangeDoesNotBlockUnrelatedEdit(t *testing.T) {
	f := newPatchFixture(t)
	c := f.get()
	c.SequenceMin, c.SequenceMax = ptr(9), ptr(2)
	if err := f.repo.Update(context.Background(), f.id, c); err != nil {
		t.Fatal(err)
	}
	if got := f.patch(f.id, `{"name":"Show","rootPath":"Show","isPrivate":false}`); got != 204 {
		t.Fatalf("unrelated edit blocked: %d", got)
	}
}

func TestUpdateCollectionNotFound(t *testing.T) {
	f := newPatchFixture(t)
	if got := f.patch(99999, `{"name":"X","rootPath":"X"}`); got != 404 {
		t.Fatalf("status = %d", got)
	}
}

func TestUpdateCollectionDuplicateFolder409(t *testing.T) {
	f := newPatchFixture(t)
	// "Other" exists as a sibling folder; case-different must also be refused.
	for _, root := range []string{"Other", "other"} {
		if code := f.patch(f.id, `{"name":"Show","rootPath":"`+root+`"}`); code != http.StatusConflict {
			t.Fatalf("rootPath %q: got %d, want 409", root, code)
		}
	}
	if got := f.get().RootPath; got != "Show" {
		t.Fatalf("refused patch changed root path to %q", got)
	}
	// Duplicate name keeps its own 409.
	if code := f.patch(f.id, `{"name":"Other","rootPath":"Show"}`); code != http.StatusConflict {
		t.Fatalf("duplicate name: got %d, want 409", code)
	}
	// Unchanged folder is fine.
	if code := f.patch(f.id, `{"name":"Show","rootPath":"Show","isPrivate":false}`); code != http.StatusNoContent {
		t.Fatalf("unchanged folder: got %d, want 204", code)
	}
}

func TestCreateCollectionDuplicateFolder409(t *testing.T) {
	gin.SetMode(gin.TestMode)
	conn := openMigratedTestDB(t)
	repo := repository.NewCollectionsRepo(conn)
	mgr := queue.NewDownloadManager(t.TempDir(), t.TempDir(), "", nil, nil, nil, repo, nil, nil, nil, nil, nil, nil, nil, queue.NewProgressStore(), nil)
	r := gin.New()
	r.POST("/api/collections", CreateCollection(repo, mgr))
	post := func(body string) (int, string) {
		req := httptest.NewRequest(http.MethodPost, "/api/collections", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code, w.Body.String()
	}
	if code, body := post(`{"name":"One","rootPath":"Concerts"}`); code != http.StatusCreated {
		t.Fatalf("first create: %d %s", code, body)
	}
	code, body := post(`{"name":"Two","rootPath":"concerts"}`)
	if code != http.StatusConflict || !strings.Contains(body, "another collection in this folder already uses that folder name") {
		t.Fatalf("duplicate folder: %d %s", code, body)
	}
	code, body = post(`{"name":"One","rootPath":"Elsewhere"}`)
	if code != http.StatusConflict || !strings.Contains(body, "collection name already in use") {
		t.Fatalf("duplicate name: %d %s", code, body)
	}
}

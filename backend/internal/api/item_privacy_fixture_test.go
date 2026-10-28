package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// privacyFixture is a migrated throwaway DB plus the repos the item-response
// path needs, with small seed helpers. Shared by the privacy tests.
type privacyFixture struct {
	t           *testing.T
	conn        *sql.DB
	ctx         context.Context
	settings    *repository.SettingsRepo
	collections *repository.CollectionsRepo
	tags        *repository.TagsRepo
	gallery     *repository.ThumbnailGalleryRepo
	library     *repository.LibraryRepo
	compare     *repository.CompareListRepo
	mediaRoot   string
}

func newPrivacyFixture(t *testing.T) *privacyFixture {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatalf("opening test db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatalf("migrating test db: %v", err)
	}
	return &privacyFixture{
		t:           t,
		conn:        conn,
		ctx:         context.Background(),
		settings:    repository.NewSettingsRepo(conn),
		collections: repository.NewCollectionsRepo(conn),
		tags:        repository.NewTagsRepo(conn),
		gallery:     repository.NewThumbnailGalleryRepo(conn),
		library:     repository.NewLibraryRepo(conn),
		compare:     repository.NewCompareListRepo(conn),
		mediaRoot:   t.TempDir(),
	}
}

func (f *privacyFixture) responder() *ItemResponder {
	return NewItemResponder(f.settings, f.collections, f.tags, f.gallery, f.mediaRoot)
}

func (f *privacyFixture) setPrivacy(on bool) {
	f.t.Helper()
	if err := f.settings.Set(f.ctx, models.SettingPrivacyEnabled, strconv.FormatBool(on)); err != nil {
		f.t.Fatal(err)
	}
}

func (f *privacyFixture) collection(name string, parent *int64, private bool) *int64 {
	f.t.Helper()
	id, err := f.collections.Create(f.ctx, &models.Collection{Name: name, RootPath: name, ParentID: parent, IsPrivate: private})
	if err != nil {
		f.t.Fatal(err)
	}
	return &id
}

func (f *privacyFixture) tag(name string, private bool) {
	f.t.Helper()
	if _, err := f.tags.Create(f.ctx, name, private); err != nil {
		f.t.Fatal(err)
	}
}

// item inserts a completed library item and applies tagNames to it.
func (f *privacyFixture) item(title string, collectionID *int64, tagNames ...string) int64 {
	f.t.Helper()
	id, err := f.library.Create(f.ctx, &models.LibraryItem{
		Title: title, Filename: title + ".mp4", Path: title + ".mp4", CollectionID: collectionID, Status: "completed",
	})
	if err != nil {
		f.t.Fatal(err)
	}
	if len(tagNames) > 0 {
		ids, err := f.tags.GetOrCreateByNames(f.ctx, tagNames)
		if err != nil {
			f.t.Fatal(err)
		}
		if err := f.tags.SetForLibraryItem(f.ctx, id, ids); err != nil {
			f.t.Fatal(err)
		}
	}
	return id
}

func (f *privacyFixture) get(id int64) models.LibraryItem {
	f.t.Helper()
	item, err := f.library.Get(f.ctx, id)
	if err != nil {
		f.t.Fatal(err)
	}
	return *item
}

// serve performs a request against a router built by mount and decodes the
// JSON body into out.
func serve(t *testing.T, mount func(r *gin.Engine), method, url string, out any) *httptest.ResponseRecorder {
	t.Helper()
	return serveJSON(t, mount, method, url, nil, out)
}

// serveJSON is serve with a JSON request body (nil = none).
func serveJSON(t *testing.T, mount func(r *gin.Engine), method, url string, body any, out any) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	mount(r)
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, url, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if out != nil && w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
			t.Fatalf("decoding %s %s response %q: %v", method, url, w.Body.String(), err)
		}
	}
	return w
}

// privacyScenario seeds the shared cases the handler tests check: an item in
// a child collection whose parent is private (child itself is not), an item
// with a private tag only, and a plain item.
type privacyScenario struct {
	inPrivateParent, privateTagged, plain int64
	child                                 *int64
}

func (f *privacyFixture) scenario() privacyScenario {
	parent := f.collection("parent", nil, true)
	child := f.collection("child", parent, false)
	f.tag("secret", true)
	return privacyScenario{
		inPrivateParent: f.item("in-parent", child),
		privateTagged:   f.item("tagged", nil, "secret"),
		plain:           f.item("plain", nil),
		child:           child,
	}
}

// blurredByID flattens a list of item responses to id -> blurred.
func blurredByID(items []LibraryItemResponse) map[int64]bool {
	m := make(map[int64]bool, len(items))
	for _, it := range items {
		m[it.ID] = it.Blurred
	}
	return m
}

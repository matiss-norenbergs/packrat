package api

import (
	"context"
	"path/filepath"
	"strconv"
	"testing"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// privacyFixture is a migrated throwaway DB plus the repos the item-response
// path needs, with small seed helpers. Shared by the privacy tests.
type privacyFixture struct {
	t           *testing.T
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
	id, err := f.collections.Create(f.ctx, &models.Collection{Name: name, ParentID: parent, IsPrivate: private})
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

package api

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/db"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

type cleanupEnv struct {
	conn       *sql.DB
	library    *repository.LibraryRepo
	originals  *repository.ThumbnailEnhancementOriginalsRepo
	queue      *repository.FrameMatchQueueRepo
	mediaRoot  string
	imagesRoot string
}

func newCleanupEnv(t *testing.T) *cleanupEnv {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "packrat_test.db"))
	if err != nil {
		t.Fatalf("opening test db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	migrationsDir, err := filepath.Abs("../../../database/migrations")
	if err != nil {
		t.Fatalf("resolving migrations dir: %v", err)
	}
	if err := db.Migrate(conn, migrationsDir); err != nil {
		t.Fatalf("migrating test db: %v", err)
	}
	return &cleanupEnv{
		conn:       conn,
		library:    repository.NewLibraryRepo(conn),
		originals:  repository.NewThumbnailEnhancementOriginalsRepo(conn),
		queue:      repository.NewFrameMatchQueueRepo(conn),
		mediaRoot:  t.TempDir(),
		imagesRoot: t.TempDir(),
	}
}

func writeFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// seedItem creates a library item with a media file, .nfo sidecar, MediaRoot
// thumbnail, WebP tiers, an AI-enhancement original, a thumbnail-gallery
// file and one frame-match queue row with a snapshot dir. Returns the item
// id and the interesting paths.
type seeded struct {
	id                                              int64
	media, nfo, thumb, small, medium, orig, gallery string
	libDir, galleryDir, frameDir                    string
}

func (e *cleanupEnv) seedItem(t *testing.T, name string) seeded {
	t.Helper()
	ctx := context.Background()
	thumbRel := name + ".jpg"
	smallRel := "library/PLACEHOLDER/small.webp"
	mediumRel := "library/PLACEHOLDER/medium.webp"
	id, err := e.library.Create(ctx, &models.LibraryItem{
		Title: name, Filename: name + ".mp4", Path: name + ".mp4", Status: "completed", Thumbnail: &thumbRel,
	})
	if err != nil {
		t.Fatalf("creating item: %v", err)
	}
	sid := fmt.Sprint(id)
	smallRel = "library/" + sid + "/small.webp"
	mediumRel = "library/" + sid + "/medium.webp"
	w, h := 640, 360
	if err := e.library.UpdateThumbnailTiers(ctx, id, &smallRel, &mediumRel, &w, &h); err != nil {
		t.Fatalf("setting tiers: %v", err)
	}

	s := seeded{
		id:         id,
		media:      filepath.Join(e.mediaRoot, name+".mp4"),
		nfo:        filepath.Join(e.mediaRoot, name+".nfo"),
		thumb:      filepath.Join(e.mediaRoot, thumbRel),
		small:      filepath.Join(e.imagesRoot, filepath.FromSlash(smallRel)),
		medium:     filepath.Join(e.imagesRoot, filepath.FromSlash(mediumRel)),
		orig:       filepath.Join(e.imagesRoot, "library", sid, "original.webp"),
		gallery:    filepath.Join(e.imagesRoot, "thumbnail-gallery", sid, "g1.webp"),
		libDir:     filepath.Join(e.imagesRoot, "library", sid),
		galleryDir: filepath.Join(e.imagesRoot, "thumbnail-gallery", sid),
	}
	for _, p := range []string{s.media, s.nfo, s.thumb, s.small, s.medium, s.orig, s.gallery} {
		writeFile(t, p)
	}
	if err := e.originals.Create(ctx, id, "library/"+sid+"/original.webp"); err != nil {
		t.Fatalf("recording original: %v", err)
	}
	qid, err := e.queue.Create(ctx, id, name, "current")
	if err != nil {
		t.Fatalf("enqueueing frame match: %v", err)
	}
	s.frameDir = filepath.Join(e.imagesRoot, "frame-match", fmt.Sprint(qid))
	writeFile(t, filepath.Join(s.frameDir, "f1.webp"))
	return s
}

func (e *cleanupEnv) do(t *testing.T, h gin.HandlerFunc, method, path, route, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Handle(method, route, h)
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func (e *cleanupEnv) itemExists(t *testing.T, id int64) bool {
	t.Helper()
	_, err := e.library.Get(context.Background(), id)
	return err == nil
}

func assertGone(t *testing.T, paths ...string) {
	t.Helper()
	for _, p := range paths {
		if exists(p) {
			t.Errorf("expected %s to be removed", p)
		}
	}
}

func assertPresent(t *testing.T, paths ...string) {
	t.Helper()
	for _, p := range paths {
		if !exists(p) {
			t.Errorf("expected %s to still exist", p)
		}
	}
}

func TestPurgeLibraryItemArtifacts(t *testing.T) {
	ctx := context.Background()

	t.Run("without deleteFiles only ImagesRoot artifacts go", func(t *testing.T) {
		e := newCleanupEnv(t)
		s := e.seedItem(t, "a")
		item, _ := e.library.Get(ctx, s.id)
		art, err := collectLibraryItemArtifacts(ctx, e.library, item)
		if err != nil || len(art.QueueIDs) != 1 {
			t.Fatalf("collect: ids=%v err=%v", art.QueueIDs, err)
		}
		purgeLibraryItemArtifacts(e.mediaRoot, e.imagesRoot, art, false)
		assertGone(t, s.libDir, s.galleryDir, s.frameDir)
		assertPresent(t, s.media, s.nfo, s.thumb)
	})

	t.Run("with deleteFiles media, thumbnail and nfo go too", func(t *testing.T) {
		e := newCleanupEnv(t)
		s := e.seedItem(t, "b")
		item, _ := e.library.Get(ctx, s.id)
		art, _ := collectLibraryItemArtifacts(ctx, e.library, item)
		purgeLibraryItemArtifacts(e.mediaRoot, e.imagesRoot, art, true)
		assertGone(t, s.libDir, s.galleryDir, s.frameDir, s.media, s.nfo, s.thumb)
	})

	t.Run("missing paths and ghost items are fine and never touch mediaRoot", func(t *testing.T) {
		e := newCleanupEnv(t)
		art := libraryItemArtifacts{Item: &models.LibraryItem{ID: 99}, QueueIDs: []int64{7}}
		purgeLibraryItemArtifacts(e.mediaRoot, e.imagesRoot, art, true)
		assertPresent(t, e.mediaRoot)
	})

	t.Run("does not touch other items", func(t *testing.T) {
		e := newCleanupEnv(t)
		a, b := e.seedItem(t, "c"), e.seedItem(t, "d")
		item, _ := e.library.Get(ctx, a.id)
		art, _ := collectLibraryItemArtifacts(ctx, e.library, item)
		purgeLibraryItemArtifacts(e.mediaRoot, e.imagesRoot, art, true)
		assertPresent(t, b.libDir, b.galleryDir, b.frameDir, b.media, b.nfo)
	})
}

func TestDeleteLibraryItemRemovesArtifacts(t *testing.T) {
	for _, deleteFiles := range []bool{false, true} {
		t.Run(fmt.Sprintf("deleteFiles=%v", deleteFiles), func(t *testing.T) {
			e := newCleanupEnv(t)
			s := e.seedItem(t, "single")
			h := DeleteLibraryItem(e.library, e.mediaRoot, e.imagesRoot)
			w := e.do(t, h, http.MethodDelete, fmt.Sprintf("/library/%d?deleteFiles=%v", s.id, deleteFiles), "/library/:id", "")
			if w.Code != http.StatusNoContent {
				t.Fatalf("status = %d: %s", w.Code, w.Body)
			}
			if e.itemExists(t, s.id) {
				t.Fatal("row still exists")
			}
			assertGone(t, s.libDir, s.galleryDir, s.frameDir)
			if deleteFiles {
				assertGone(t, s.media, s.nfo, s.thumb)
			} else {
				assertPresent(t, s.media, s.nfo, s.thumb)
			}
		})
	}
}

func TestBulkDeleteLibraryItems(t *testing.T) {
	t.Run("removes artifacts after commit", func(t *testing.T) {
		e := newCleanupEnv(t)
		a, b := e.seedItem(t, "ba"), e.seedItem(t, "bb")
		h := BulkDeleteLibraryItems(e.conn, e.library, e.mediaRoot, e.imagesRoot)
		body := fmt.Sprintf(`{"itemIds":[%d,%d,12345],"deleteFiles":true}`, a.id, b.id)
		w := e.do(t, h, http.MethodPost, "/library/bulk-delete", "/library/bulk-delete", body)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", w.Code, w.Body)
		}
		for _, s := range []seeded{a, b} {
			assertGone(t, s.libDir, s.galleryDir, s.frameDir, s.media, s.nfo, s.thumb)
		}
	})

	t.Run("a failed batch (rolled back) leaves disk untouched", func(t *testing.T) {
		e := newCleanupEnv(t)
		a, b := e.seedItem(t, "fa"), e.seedItem(t, "fb")
		// Make the second delete blow up mid-batch, after the first row was
		// already deleted inside the tx.
		if _, err := e.conn.Exec(fmt.Sprintf(
			`CREATE TRIGGER block_delete BEFORE DELETE ON library WHEN OLD.id = %d BEGIN SELECT RAISE(ABORT, 'boom'); END`, b.id)); err != nil {
			t.Fatal(err)
		}
		h := BulkDeleteLibraryItems(e.conn, e.library, e.mediaRoot, e.imagesRoot)
		body := fmt.Sprintf(`{"itemIds":[%d,%d],"deleteFiles":true}`, a.id, b.id)
		w := e.do(t, h, http.MethodPost, "/library/bulk-delete", "/library/bulk-delete", body)
		if w.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500: %s", w.Code, w.Body)
		}
		if !e.itemExists(t, a.id) || !e.itemExists(t, b.id) {
			t.Fatal("rows should have been rolled back")
		}
		for _, s := range []seeded{a, b} {
			assertPresent(t, s.libDir, s.galleryDir, s.frameDir, s.media, s.nfo, s.thumb, s.orig)
		}
	})
}

func TestDeleteLibraryItemFileArtifacts(t *testing.T) {
	ctx := context.Background()

	t.Run("without deleteThumbnail only media and nfo go", func(t *testing.T) {
		e := newCleanupEnv(t)
		s := e.seedItem(t, "df")
		h := DeleteLibraryItemFile(e.library, e.originals, e.mediaRoot, e.imagesRoot)
		w := e.do(t, h, http.MethodDelete, fmt.Sprintf("/library/%d/file", s.id), "/library/:id/file", "")
		if w.Code != http.StatusNoContent {
			t.Fatalf("status = %d: %s", w.Code, w.Body)
		}
		assertGone(t, s.media, s.nfo)
		assertPresent(t, s.thumb, s.small, s.medium, s.orig)
		item, _ := e.library.Get(ctx, s.id)
		if item.ThumbnailSmallPath == nil {
			t.Error("thumbnail fields should be kept")
		}
	})

	t.Run("with deleteThumbnail tiers, original and dimensions go", func(t *testing.T) {
		e := newCleanupEnv(t)
		s := e.seedItem(t, "dt")
		h := DeleteLibraryItemFile(e.library, e.originals, e.mediaRoot, e.imagesRoot)
		w := e.do(t, h, http.MethodDelete, fmt.Sprintf("/library/%d/file?deleteThumbnail=true", s.id), "/library/:id/file", "")
		if w.Code != http.StatusNoContent {
			t.Fatalf("status = %d: %s", w.Code, w.Body)
		}
		assertGone(t, s.media, s.nfo, s.thumb, s.small, s.medium, s.orig)
		item, _ := e.library.Get(ctx, s.id)
		if item.ThumbnailSmallPath != nil || item.ThumbnailWidth != nil || item.ThumbnailHeight != nil {
			t.Errorf("thumbnail fields not cleared: %+v", item)
		}
		if _, err := e.originals.Get(ctx, s.id); err == nil {
			t.Error("original pointer row should be gone")
		}
	})

	t.Run("bulk with deleteThumbnail", func(t *testing.T) {
		e := newCleanupEnv(t)
		a, b := e.seedItem(t, "bda"), e.seedItem(t, "bdb")
		h := BulkDeleteLibraryItemFiles(e.conn, e.library, e.originals, e.mediaRoot, e.imagesRoot)
		body := fmt.Sprintf(`{"itemIds":[%d,%d],"deleteThumbnail":true}`, a.id, b.id)
		w := e.do(t, h, http.MethodPost, "/library/bulk-delete-file", "/library/bulk-delete-file", body)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", w.Code, w.Body)
		}
		for _, s := range []seeded{a, b} {
			assertGone(t, s.media, s.nfo, s.thumb, s.small, s.medium, s.orig)
		}
	})
}

func TestDeleteLibraryItemThumbnailRemovesOriginal(t *testing.T) {
	e := newCleanupEnv(t)
	s := e.seedItem(t, "th")
	h := DeleteLibraryItemThumbnail(e.mediaRoot, e.imagesRoot, e.library, e.originals)
	w := e.do(t, h, http.MethodDelete, fmt.Sprintf("/library/%d/thumbnail", s.id), "/library/:id/thumbnail", "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	assertGone(t, s.thumb, s.small, s.medium, s.orig)
	assertPresent(t, s.media)
	if _, err := e.originals.Get(context.Background(), s.id); err == nil {
		t.Error("original pointer row should be gone")
	}
}

func TestDeleteCollectionAndArtistRemoveImageDirs(t *testing.T) {
	ctx := context.Background()

	t.Run("collection single and bulk", func(t *testing.T) {
		e := newCleanupEnv(t)
		repo := repository.NewCollectionsRepo(e.conn)
		var ids []int64
		for _, n := range []string{"one", "two"} {
			id, err := repo.Create(ctx, &models.Collection{Name: n, RootPath: n, DefaultQuality: "best", DefaultDownloadType: "video"})
			if err != nil {
				t.Fatal(err)
			}
			ids = append(ids, id)
			writeFile(t, filepath.Join(e.imagesRoot, "collections", fmt.Sprint(id), "cover.webp"))
		}
		w := e.do(t, DeleteCollection(repo, e.imagesRoot), http.MethodDelete, fmt.Sprintf("/c/%d", ids[0]), "/c/:id", "")
		if w.Code != http.StatusNoContent {
			t.Fatalf("status = %d: %s", w.Code, w.Body)
		}
		assertGone(t, filepath.Join(e.imagesRoot, "collections", fmt.Sprint(ids[0])))
		assertPresent(t, filepath.Join(e.imagesRoot, "collections", fmt.Sprint(ids[1])))

		w = e.do(t, BulkDeleteCollections(e.conn, repo, e.imagesRoot), http.MethodPost, "/c", "/c", fmt.Sprintf(`{"ids":[%d]}`, ids[1]))
		if w.Code != http.StatusOK {
			t.Fatalf("bulk status = %d: %s", w.Code, w.Body)
		}
		assertGone(t, filepath.Join(e.imagesRoot, "collections", fmt.Sprint(ids[1])))
	})

	t.Run("artist single and bulk", func(t *testing.T) {
		e := newCleanupEnv(t)
		repo := repository.NewArtistsRepo(e.conn)
		var ids []int64
		for _, n := range []string{"one", "two"} {
			a, err := repo.Create(ctx, n, nil)
			if err != nil {
				t.Fatal(err)
			}
			ids = append(ids, a.ID)
			writeFile(t, filepath.Join(e.imagesRoot, "artists", fmt.Sprint(a.ID), "img.webp"))
		}
		w := e.do(t, DeleteArtist(repo, e.imagesRoot), http.MethodDelete, fmt.Sprintf("/a/%d", ids[0]), "/a/:id", "")
		if w.Code != http.StatusNoContent {
			t.Fatalf("status = %d: %s", w.Code, w.Body)
		}
		assertGone(t, filepath.Join(e.imagesRoot, "artists", fmt.Sprint(ids[0])))
		assertPresent(t, filepath.Join(e.imagesRoot, "artists", fmt.Sprint(ids[1])))

		w = e.do(t, BulkDeleteArtists(e.conn, repo, e.imagesRoot), http.MethodPost, "/a", "/a", fmt.Sprintf(`{"ids":[%d]}`, ids[1]))
		if w.Code != http.StatusOK {
			t.Fatalf("bulk status = %d: %s", w.Code, w.Body)
		}
		assertGone(t, filepath.Join(e.imagesRoot, "artists", fmt.Sprint(ids[1])))
	})
}

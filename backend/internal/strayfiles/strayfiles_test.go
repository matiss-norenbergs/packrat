package strayfiles

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"packrat/backend/internal/db"
)

type env struct {
	cfg Config
	now time.Time
}

func newEnv(t *testing.T) *env {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	mig, _ := filepath.Abs("../../../database/migrations")
	if err := db.Migrate(conn, mig); err != nil {
		t.Fatal(err)
	}
	return &env{cfg: Config{DB: conn, MediaRoot: t.TempDir(), ImagesRoot: t.TempDir()}, now: time.Now()}
}

// put writes a file under root, back-dated so it passes the age cutoff
// unless recent is set.
func (e *env) put(t *testing.T, root, rel string, recent bool) {
	t.Helper()
	abs := filepath.Join(map[string]string{RootImages: e.cfg.ImagesRoot, RootMedia: e.cfg.MediaRoot}[root], filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, []byte("12345"), 0o644); err != nil {
		t.Fatal(err)
	}
	mt := e.now.Add(-time.Hour)
	if recent {
		mt = e.now.Add(-time.Minute)
	}
	if err := os.Chtimes(abs, mt, mt); err != nil {
		t.Fatal(err)
	}
}

func (e *env) exec(t *testing.T, q string, args ...any) {
	t.Helper()
	if _, err := e.cfg.DB.Exec(q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func (e *env) scan(t *testing.T) map[string]Entry {
	t.Helper()
	res, err := Scan(context.Background(), e.cfg, e.now)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]Entry{}
	for _, en := range res.Entries {
		out[en.Root+":"+en.Path] = en
	}
	if res.Totals.Count != len(res.Entries) {
		t.Errorf("totals count %d != %d entries", res.Totals.Count, len(res.Entries))
	}
	return out
}

func (e *env) libraryItem(t *testing.T, path string, thumb, small *string) int64 {
	t.Helper()
	res, err := e.cfg.DB.Exec(`INSERT INTO library (title, filename, path, thumbnail, thumbnail_small_path, status) VALUES ('t', ?, ?, ?, ?, 'completed')`,
		filepath.Base(path), path, thumb, small)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

func want(t *testing.T, got map[string]Entry, key, reason string) {
	t.Helper()
	en, ok := got[key]
	if !ok {
		t.Fatalf("expected %s to be flagged; got %v", key, keys(got))
	}
	if en.Reason != reason {
		t.Errorf("%s reason = %q, want %q", key, en.Reason, reason)
	}
}

func notWant(t *testing.T, got map[string]Entry, key string) {
	t.Helper()
	if _, ok := got[key]; ok {
		t.Errorf("%s must not be flagged", key)
	}
}

func keys(m map[string]Entry) []string {
	var k []string
	for s := range m {
		k = append(k, s)
	}
	return k
}

func TestImagesReferencedFilesNotFlagged(t *testing.T) {
	e := newEnv(t)
	small := "library/1/small/a.webp"
	id := e.libraryItem(t, "a.mp4", nil, &small)
	if id != 1 {
		t.Fatalf("id = %d", id)
	}
	e.exec(t, `UPDATE library SET thumbnail_medium_path = 'library/1/medium/a.webp' WHERE id = 1`)
	e.exec(t, `INSERT INTO thumbnail_enhancement_originals (library_item_id, original_path) VALUES (1, 'library/1/original/o.jpg')`)
	e.exec(t, `INSERT INTO thumbnail_gallery (library_item_id, image_path) VALUES (1, 'thumbnail-gallery/1/g.webp')`)
	e.exec(t, `INSERT INTO frame_match_queue (library_item_id, item_title, mode, state, found_frame_path, reference_image_path) VALUES (1, 't', 'url', 'done', 'frame-match/1/found.jpg', 'frame-match/1/reference.jpg')`)
	e.exec(t, `INSERT INTO collections (name, root_path, default_quality, default_download_type, cover_image_path, cover_image_small_path, cover_image_medium_path) VALUES ('c', 'c', 'best', 'video', 'collections/1/original/o.webp', 'collections/1/small/s.webp', 'collections/1/medium/m.webp')`)
	e.exec(t, `INSERT INTO artists (name) VALUES ('a')`)
	e.exec(t, `INSERT INTO artist_images (artist_id, relative_path) VALUES (1, 'artists/1/image/i.webp')`)
	for _, p := range []string{
		"library/1/small/a.webp", "library/1/medium/a.webp", "library/1/original/o.jpg",
		"thumbnail-gallery/1/g.webp", "frame-match/1/found.jpg", "frame-match/1/reference.jpg",
		"collections/1/original/o.webp", "collections/1/small/s.webp", "collections/1/medium/m.webp",
		"artists/1/image/i.webp",
	} {
		e.put(t, RootImages, p, false)
	}
	if got := e.scan(t); len(got) != 0 {
		t.Fatalf("expected nothing stray, got %v", keys(got))
	}
}

func TestImagesUnreferencedFileUnderLiveOwner(t *testing.T) {
	e := newEnv(t)
	small := "library/1/small/a.webp"
	e.libraryItem(t, "a.mp4", nil, &small)
	e.put(t, RootImages, "library/1/small/a.webp", false)
	e.put(t, RootImages, "library/1/small/old-tier.webp", false)
	got := e.scan(t)
	want(t, got, "images:library/1/small/old-tier.webp", ReasonUnreferenced)
	notWant(t, got, "images:library/1/small/a.webp")
	if got["images:library/1/small/old-tier.webp"].SizeBytes != 5 {
		t.Errorf("size = %d", got["images:library/1/small/old-tier.webp"].SizeBytes)
	}
}

func TestImagesOwnerDeletedCollapsesToDirectory(t *testing.T) {
	e := newEnv(t)
	for _, p := range []string{"library/77/small/a.webp", "library/77/medium/a.webp", "library/77/original/o.jpg",
		"thumbnail-gallery/77/g.webp", "frame-match/9/found.jpg", "collections/5/small/s.webp", "artists/3/image/i.webp"} {
		e.put(t, RootImages, p, false)
	}
	got := e.scan(t)
	for _, k := range []string{"images:library/77", "images:thumbnail-gallery/77", "images:frame-match/9", "images:collections/5", "images:artists/3"} {
		want(t, got, k, ReasonOwnerDeleted)
	}
	if len(got) != 5 {
		t.Errorf("expected only the 5 directory entries, got %v", keys(got))
	}
	if got["images:library/77"].SizeBytes != 15 {
		t.Errorf("dir size = %d, want 15", got["images:library/77"].SizeBytes)
	}
}

func TestImagesSkipsUnknownDirsAndCache(t *testing.T) {
	e := newEnv(t)
	e.put(t, RootImages, "mystery/1/x.webp", false)
	e.put(t, RootImages, "cache/ab/x.webp", false)
	e.put(t, RootImages, "loose.webp", false)
	if got := e.scan(t); len(got) != 0 {
		t.Fatalf("unknown top-level content must be ignored, got %v", keys(got))
	}
}

func TestRecentFilesAreSkipped(t *testing.T) {
	e := newEnv(t)
	e.put(t, RootImages, "library/1/small/x.webp", true) // no owner row, but fresh
	e.put(t, RootImages, "library/77/small/old.webp", false)
	e.put(t, RootImages, "library/77/small/new.webp", true) // dir has a recent file
	e.put(t, RootMedia, "gone.nfo", true)
	e.put(t, RootMedia, "dl.mp4.part", true)
	got := e.scan(t)
	if len(got) != 0 {
		t.Fatalf("recent files must never be flagged, got %v", keys(got))
	}
}

func TestMediaOnlyAppLeftoversFlagged(t *testing.T) {
	e := newEnv(t)
	// Orphans.
	e.put(t, RootMedia, "Music/gone.nfo", false)
	e.put(t, RootMedia, "Music/gone.jpg", false)
	e.put(t, RootMedia, "Music/vid.trim-preview-abc.mp4", false)
	e.put(t, RootMedia, "Music/dl.webm.part", false)
	// Media file without a row: unimported, never flagged.
	e.put(t, RootMedia, "Music/unimported.mp4", false)
	// Sidecars next to an existing media file (even without a row).
	e.put(t, RootMedia, "Music/unimported.nfo", false)
	e.put(t, RootMedia, "Music/unimported.jpg", false)
	// Sidecars whose row still exists though the media file is gone.
	thumb := "Music/ghost.jpg"
	e.libraryItem(t, "Music/ghost.mp4", &thumb, nil)
	e.put(t, RootMedia, "Music/ghost.nfo", false)
	e.put(t, RootMedia, "Music/ghost.jpg", false)
	// Jellyfin artwork / metadata belongs to the user.
	e.put(t, RootMedia, "Music/folder.jpg", false)
	e.put(t, RootMedia, "Music/tvshow.nfo", false)
	// An image library item: the .jpg is the media itself.
	e.libraryItem(t, "Pics/photo.jpg", nil, nil)
	e.put(t, RootMedia, "Pics/photo.jpg", false)

	got := e.scan(t)
	want(t, got, "media:Music/gone.nfo", ReasonOrphanNFO)
	want(t, got, "media:Music/gone.jpg", ReasonOrphanThumb)
	want(t, got, "media:Music/vid.trim-preview-abc.mp4", ReasonTrimPreview)
	want(t, got, "media:Music/dl.webm.part", ReasonPartialDownld)
	if len(got) != 4 {
		t.Errorf("expected exactly 4 media entries, got %v", keys(got))
	}
	notWant(t, got, "media:Music/unimported.mp4")
}

func TestDeleteRevalidates(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.put(t, RootImages, "library/1/small/a.webp", false)
	e.put(t, RootImages, "library/1/small/b.webp", false)
	e.put(t, RootImages, "library/50/small/c.webp", false) // owner deleted dir
	e.put(t, RootMedia, "x.nfo", false)
	e.put(t, RootMedia, "keep.mp4", false)
	e.libraryItem(t, "keep.mp4", nil, nil)
	small := "library/1/small/b.webp"
	e.exec(t, `UPDATE library SET thumbnail_small_path = ? WHERE id = 1`, small)
	// a.webp: now stray; b.webp: referenced before the request is made.

	refs := []Ref{
		{RootImages, "library/1/small/a.webp"}, // still stray -> deleted
		{RootImages, "library/1/small/b.webp"}, // referenced again -> skipped
		{RootImages, "library/50"},             // owner-deleted dir -> deleted
		{RootMedia, "x.nfo"},                   // deleted
		{RootMedia, "keep.mp4"},                // media file: never stray -> skipped
		{RootMedia, "../escape"},               // traversal -> skipped
		{RootImages, "library"},                // kind dir, not an entry -> skipped
		{"other", "x"},                         // unknown root -> skipped
		{RootImages, "library/1/small/nope"},   // doesn't exist -> skipped
	}
	deleted, skipped, err := Delete(ctx, e.cfg, refs, e.now)
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 3 || skipped != 6 {
		t.Fatalf("deleted/skipped = %d/%d, want 3/6", deleted, skipped)
	}
	for _, p := range []string{
		filepath.Join(e.cfg.ImagesRoot, "library/1/small/a.webp"),
		filepath.Join(e.cfg.ImagesRoot, "library/50"),
		filepath.Join(e.cfg.MediaRoot, "x.nfo"),
	} {
		if _, err := os.Stat(p); err == nil {
			t.Errorf("%s should be gone", p)
		}
	}
	for _, p := range []string{
		filepath.Join(e.cfg.ImagesRoot, "library/1/small/b.webp"),
		filepath.Join(e.cfg.MediaRoot, "keep.mp4"),
		filepath.Join(e.cfg.ImagesRoot, "library"),
	} {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("%s should remain: %v", p, err)
		}
	}
}

func TestDeleteSkipsRecentlyTouchedFile(t *testing.T) {
	e := newEnv(t)
	e.put(t, RootImages, "library/1/small/a.webp", true)
	deleted, skipped, err := Delete(context.Background(), e.cfg, []Ref{{RootImages, "library/1/small/a.webp"}}, e.now)
	if err != nil || deleted != 0 || skipped != 1 {
		t.Fatalf("deleted/skipped/err = %d/%d/%v", deleted, skipped, err)
	}
}

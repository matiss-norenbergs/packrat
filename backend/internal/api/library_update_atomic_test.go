package api

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"packrat/backend/internal/models"
)

// snapshotItem is what the "changes nothing" tests compare.
type snapshotItem struct {
	title, filename, path string
	artist                *int64
	year                  *int
	nfo                   bool
	tags                  []string
}

func (e *bkEnv) snapshot(id int64) snapshotItem {
	e.t.Helper()
	it, err := e.library.Get(context.Background(), id)
	if err != nil {
		e.t.Fatal(err)
	}
	tags, _ := e.tags.TagsForLibraryItem(context.Background(), id)
	slices.Sort(tags)
	return snapshotItem{it.Title, it.Filename, it.Path, it.ArtistID, it.ReleaseYear, it.GenerateNFO, tags}
}

func (e *bkEnv) requireUnchanged(id int64, before snapshotItem) {
	e.t.Helper()
	after := e.snapshot(id)
	if after.title != before.title || after.filename != before.filename || after.path != before.path ||
		(after.artist == nil) != (before.artist == nil) || (after.year == nil) != (before.year == nil) ||
		after.nfo != before.nfo || !slices.Equal(after.tags, before.tags) {
		e.t.Fatalf("item changed:\n before %+v\n after  %+v", before, after)
	}
}

// everyField is a request touching title, filename, artist, year, tags and the NFO flag.
func everyField(artistID int64, filename string) map[string]any {
	return map[string]any{
		"title": "Changed title", "filename": filename, "artistId": artistID, "year": 2001,
		"tags": []string{"new-tag"}, "generateNfo": true, "uploader": "someone",
	}
}

func TestUpdate_RenameCollisionChangesNothing(t *testing.T) {
	for _, taken := range []string{"bar.mp4", "bar.jpg", "bar.nfo"} {
		t.Run(taken, func(t *testing.T) {
			e := newBkEnv(t)
			artist, _ := e.artists.Create(context.Background(), "A", nil)
			id := e.sidecarItem("foo", true, false)
			if err := os.WriteFile(filepath.Join(e.mediaRoot, taken), []byte("other"), 0o644); err != nil {
				t.Fatal(err)
			}
			before := e.snapshot(id)

			r := e.rename(id, everyField(artist.ID, "bar"))
			if r.OK || r.Status != http.StatusConflict {
				t.Fatalf("result = %+v, want 409", r)
			}
			e.requireUnchanged(id, before)
			e.requireFiles([]string{"foo.mp4", "foo.jpg", "foo.nfo", taken}, "foo.mp4", "foo.jpg", "foo.nfo", "bar.mp4", "bar.jpg", "bar.nfo")
			if lines := e.embedLines(); len(lines) != 0 {
				t.Fatalf("a remux was scheduled for a rejected edit: %v", lines)
			}
		})
	}
}

func TestUpdate_FilenameOnItemWithoutMediaFileIs400AndChangesNothing(t *testing.T) {
	e := newBkEnv(t)
	artist, _ := e.artists.Create(context.Background(), "A", nil)
	id, err := e.library.Create(context.Background(), &models.LibraryItem{Title: "ghost", Status: "ghost"})
	if err != nil {
		t.Fatal(err)
	}
	before := e.snapshot(id)
	r := e.rename(id, everyField(artist.ID, "bar"))
	if r.OK || r.Status != http.StatusBadRequest || r.Error != "item has no media file to rename" {
		t.Fatalf("result = %+v", r)
	}
	e.requireUnchanged(id, before)
}

func TestUpdate_InvalidFilenameIs400AndChangesNothing(t *testing.T) {
	e := newBkEnv(t)
	artist, _ := e.artists.Create(context.Background(), "A", nil)
	id := e.sidecarItem("foo", true, false)
	before := e.snapshot(id)
	r := e.rename(id, everyField(artist.ID, " ../ "))
	if r.OK || r.Status != http.StatusBadRequest || r.Error != "invalid filename" {
		t.Fatalf("result = %+v", r)
	}
	e.requireUnchanged(id, before)
	e.requireFiles([]string{"foo.mp4", "foo.jpg", "foo.nfo"}, "foo.mp4", "foo.jpg", "foo.nfo")
}

func TestUpdate_UnknownArtistIs400AndChangesNothing(t *testing.T) {
	e := newBkEnv(t)
	id := e.sidecarItem("foo", false, false)
	before := e.snapshot(id)
	r := e.rename(id, everyField(9999, "bar"))
	if r.OK || r.Status != http.StatusBadRequest {
		t.Fatalf("result = %+v, want 400", r)
	}
	e.requireUnchanged(id, before)
	e.requireFiles([]string{"foo.mp4", "foo.jpg"}, "foo.mp4", "foo.jpg", "bar.mp4", "bar.jpg")
}

func TestUpdate_MultiFieldEditAppliesEverything(t *testing.T) {
	e := newBkEnv(t)
	ctx := context.Background()
	artist, _ := e.artists.Create(ctx, "Some Artist", nil)
	id := e.sidecarItem("foo", true, false)

	if r := e.rename(id, everyField(artist.ID, "bar")); !r.OK {
		t.Fatalf("result = %+v", r)
	}
	it, _ := e.library.Get(ctx, id)
	if it.Title != "Changed title" || it.Filename != "bar.mp4" || it.Path != "bar.mp4" || it.Thumbnail == nil || *it.Thumbnail != "bar.jpg" ||
		it.ArtistID == nil || *it.ArtistID != artist.ID || it.ReleaseYear == nil || *it.ReleaseYear != 2001 || !it.GenerateNFO {
		t.Fatalf("item = %+v", it)
	}
	if tags, _ := e.tags.TagsForLibraryItem(ctx, id); !slices.Equal(tags, []string{"new-tag"}) {
		t.Fatalf("tags = %v", tags)
	}
	e.requireFiles([]string{"bar.mp4", "bar.jpg", "bar.nfo"}, "foo.mp4", "foo.jpg", "foo.nfo", "bar.mp4", "bar.jpg", "bar.nfo")
	if b, _ := os.ReadFile(filepath.Join(e.mediaRoot, "bar.nfo")); !strings.Contains(string(b), "Changed title") {
		t.Fatalf("sidecar not rewritten at the new path: %q", b)
	}
	if lines := e.embedLines(); len(lines) != 1 || !strings.Contains(lines[0], "bar.mp4") {
		t.Fatalf("embed log = %v, want one remux of the renamed file", lines)
	}
}

// If recording the new path fails, the rename is undone: files and row agree,
// and none of the request's other fields were written.
func TestUpdate_FailureRecordingNewPathRollsBackTheRename(t *testing.T) {
	e := newBkEnv(t)
	artist, _ := e.artists.Create(context.Background(), "A", nil)
	id := e.sidecarItem("foo", true, false)
	if _, err := e.conn.Exec(`CREATE TRIGGER fail_filename_update BEFORE UPDATE OF filename ON library
		BEGIN SELECT RAISE(ABORT, 'injected failure'); END`); err != nil {
		t.Fatal(err)
	}
	before := e.snapshot(id)

	r := e.rename(id, everyField(artist.ID, "bar"))
	if r.OK || r.Status != http.StatusInternalServerError {
		t.Fatalf("result = %+v, want 500", r)
	}
	e.requireUnchanged(id, before)
	e.requireFiles([]string{"foo.mp4", "foo.jpg", "foo.nfo"}, "foo.mp4", "foo.jpg", "foo.nfo", "bar.mp4", "bar.jpg", "bar.nfo")
}

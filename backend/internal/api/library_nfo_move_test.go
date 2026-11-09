package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"packrat/backend/internal/fsutil"
	"packrat/backend/internal/models"
)

// sidecarItem inserts an item "name" with name.mp4, name.jpg (its thumbnail)
// and, when withNFO, a name.nfo sidecar; generateNFO sets the item's flag.
func (e *bkEnv) sidecarItem(name string, withNFO, generateNFO bool) int64 {
	e.t.Helper()
	for _, ext := range []string{".mp4", ".jpg"} {
		if err := os.WriteFile(filepath.Join(e.mediaRoot, name+ext), []byte(name+ext), 0o644); err != nil {
			e.t.Fatal(err)
		}
	}
	if withNFO {
		if err := os.WriteFile(filepath.Join(e.mediaRoot, name+".nfo"), []byte("<movie>"+name+"</movie>"), 0o644); err != nil {
			e.t.Fatal(err)
		}
	}
	thumb := name + ".jpg"
	id, err := e.library.Create(context.Background(), &models.LibraryItem{
		Title: name, Filename: name + ".mp4", Path: name + ".mp4", Thumbnail: &thumb,
		Status: "completed", GenerateNFO: generateNFO,
	})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *bkEnv) has(rel string) bool {
	_, err := os.Lstat(filepath.Join(e.mediaRoot, filepath.FromSlash(rel)))
	return err == nil
}

// requireAt fails unless exactly the listed files exist (of the candidates).
func (e *bkEnv) requireFiles(want []string, candidates ...string) {
	e.t.Helper()
	for _, c := range candidates {
		in := false
		for _, w := range want {
			in = in || w == c
		}
		if got := e.has(c); got != in {
			e.t.Errorf("%s exists = %v, want %v", c, got, in)
		}
	}
}

func (e *bkEnv) rename(id int64, changes map[string]any) BulkItemResult[int64] {
	e.t.Helper()
	w := e.post("/library/bulk-update", updateBody(e.t, upd(id, changes)))
	e.want(w, http.StatusOK)
	got := bkDecode[BulkResultsResponse[int64]](e.t, w)
	return got.Results[0]
}

func (e *bkEnv) move(id int64, folder string) *httptest.ResponseRecorder {
	e.t.Helper()
	return e.post(fmt.Sprintf("/library/%d/move", id), bkJSON(e.t, map[string]any{"folder": folder}))
}

func TestRename_MovesNFOSidecarAlong(t *testing.T) {
	e := newBkEnv(t)
	id := e.sidecarItem("foo", true, false)
	if r := e.rename(id, map[string]any{"filename": "bar"}); !r.OK {
		t.Fatalf("result = %+v", r)
	}
	e.requireFiles([]string{"bar.mp4", "bar.jpg", "bar.nfo"}, "foo.mp4", "foo.jpg", "foo.nfo", "bar.mp4", "bar.jpg", "bar.nfo")
	if b, _ := os.ReadFile(filepath.Join(e.mediaRoot, "bar.nfo")); string(b) != "<movie>foo</movie>" {
		t.Fatalf("sidecar content changed by a pure rename (flag is off): %q", b)
	}
}

func TestRename_NoSidecarIsFine(t *testing.T) {
	e := newBkEnv(t)
	id := e.sidecarItem("foo", false, false)
	if r := e.rename(id, map[string]any{"filename": "bar"}); !r.OK {
		t.Fatalf("result = %+v", r)
	}
	e.requireFiles([]string{"bar.mp4", "bar.jpg"}, "foo.mp4", "foo.jpg", "foo.nfo", "bar.mp4", "bar.jpg", "bar.nfo")
}

// An opted-in item: the sidecar moves, and the usual sync then rewrites it at
// the new path; nothing is left under the old name.
func TestRename_OptedInItemRewritesSidecarAtNewPath(t *testing.T) {
	e := newBkEnv(t)
	id := e.sidecarItem("foo", true, true)
	if r := e.rename(id, map[string]any{"filename": "bar", "title": "Brand New Title"}); !r.OK {
		t.Fatalf("result = %+v", r)
	}
	e.requireFiles([]string{"bar.mp4", "bar.jpg", "bar.nfo"}, "foo.mp4", "foo.jpg", "foo.nfo", "bar.mp4", "bar.jpg", "bar.nfo")
	if b, _ := os.ReadFile(filepath.Join(e.mediaRoot, "bar.nfo")); !strings.Contains(string(b), "Brand New Title") {
		t.Fatalf("sidecar was not rewritten at the new path: %q", b)
	}
}

func TestRename_OccupiedNFODestinationIs409AndNothingMoves(t *testing.T) {
	e := newBkEnv(t)
	id := e.sidecarItem("foo", true, false)
	if err := os.WriteFile(filepath.Join(e.mediaRoot, "bar.nfo"), []byte("someone else's"), 0o644); err != nil {
		t.Fatal(err)
	}
	r := e.rename(id, map[string]any{"filename": "bar"})
	if r.OK || r.Status != http.StatusConflict {
		t.Fatalf("result = %+v, want 409", r)
	}
	e.requireFiles([]string{"foo.mp4", "foo.jpg", "foo.nfo", "bar.nfo"}, "foo.mp4", "foo.jpg", "foo.nfo", "bar.mp4", "bar.jpg", "bar.nfo")
	if b, _ := os.ReadFile(filepath.Join(e.mediaRoot, "bar.nfo")); string(b) != "someone else's" {
		t.Fatalf("foreign sidecar was touched: %q", b)
	}
	if it, _ := e.library.Get(context.Background(), id); it.Filename != "foo.mp4" || it.Path != "foo.mp4" {
		t.Fatalf("row changed: %+v", it)
	}
}

// Failure of the last rename (the sidecar) undoes the media and thumbnail renames.
func TestRename_SidecarRenameFailureRollsBack(t *testing.T) {
	e := newBkEnv(t)
	id := e.sidecarItem("foo", true, false)
	restore := fsutil.SetRenameFuncForTest(func(o, n string) error {
		if strings.HasSuffix(n, "bar.nfo") {
			return errors.New("injected failure")
		}
		return os.Rename(o, n)
	})
	defer restore()
	r := e.rename(id, map[string]any{"filename": "bar", "title": "T"})
	if r.OK || r.Status != http.StatusInternalServerError {
		t.Fatalf("result = %+v, want 500", r)
	}
	e.requireFiles([]string{"foo.mp4", "foo.jpg", "foo.nfo"}, "foo.mp4", "foo.jpg", "foo.nfo", "bar.mp4", "bar.jpg", "bar.nfo")
	if it, _ := e.library.Get(context.Background(), id); it.Filename != "foo.mp4" || it.Path != "foo.mp4" {
		t.Fatalf("row changed: %+v", it)
	}
}

func TestMove_MovesNFOSidecarAlong(t *testing.T) {
	e := newBkEnv(t)
	id := e.sidecarItem("foo", true, false)
	e.want(e.move(id, "sub"), http.StatusNoContent)
	e.requireFiles([]string{"sub/foo.mp4", "sub/foo.jpg", "sub/foo.nfo"}, "foo.mp4", "foo.jpg", "foo.nfo", "sub/foo.mp4", "sub/foo.jpg", "sub/foo.nfo")
	if it, _ := e.library.Get(context.Background(), id); it.Path != "sub/foo.mp4" {
		t.Fatalf("path = %q", it.Path)
	}
}

func TestMove_NoSidecarIsFine(t *testing.T) {
	e := newBkEnv(t)
	id := e.sidecarItem("foo", false, true) // flag on but the file is not there
	e.want(e.move(id, "sub"), http.StatusNoContent)
	e.requireFiles([]string{"sub/foo.mp4", "sub/foo.jpg"}, "foo.mp4", "foo.jpg", "foo.nfo", "sub/foo.mp4", "sub/foo.jpg", "sub/foo.nfo")
}

func TestMove_OccupiedNFODestinationIs409AndNothingMoves(t *testing.T) {
	e := newBkEnv(t)
	id := e.sidecarItem("foo", true, false)
	if err := os.MkdirAll(filepath.Join(e.mediaRoot, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(e.mediaRoot, "sub", "foo.nfo"), []byte("other"), 0o644); err != nil {
		t.Fatal(err)
	}
	e.want(e.move(id, "sub"), http.StatusConflict)
	e.requireFiles([]string{"foo.mp4", "foo.jpg", "foo.nfo", "sub/foo.nfo"}, "foo.mp4", "foo.jpg", "foo.nfo", "sub/foo.mp4", "sub/foo.jpg", "sub/foo.nfo")
	if it, _ := e.library.Get(context.Background(), id); it.Path != "foo.mp4" {
		t.Fatalf("row changed: %+v", it)
	}
}

func TestMove_SidecarRenameFailureRollsBack(t *testing.T) {
	e := newBkEnv(t)
	id := e.sidecarItem("foo", true, false)
	restore := fsutil.SetRenameFuncForTest(func(o, n string) error {
		if strings.HasSuffix(n, ".nfo") && strings.Contains(n, "sub") {
			return errors.New("injected failure")
		}
		return os.Rename(o, n)
	})
	defer restore()
	e.want(e.move(id, "sub"), http.StatusInternalServerError)
	e.requireFiles([]string{"foo.mp4", "foo.jpg", "foo.nfo"}, "foo.mp4", "foo.jpg", "foo.nfo", "sub/foo.mp4", "sub/foo.jpg", "sub/foo.nfo")
}

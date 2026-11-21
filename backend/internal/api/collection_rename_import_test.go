package api

// Investigation tests: what the untracked-file scan/import and the library
// bundle endpoints do after a collection's FOLDER name was renamed. They go
// through the real router (bkEnv) and assert today's behavior; problems are
// marked `KNOWN LIMITATION` and written up in docs/TODO.md. The same questions
// for the bundle functions themselves are in internal/backup/library_rename_test.go.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

type renameImportEnv struct {
	*bkEnv
	cols *repository.CollectionsRepo
}

func newRenameImportEnv(t *testing.T) *renameImportEnv {
	t.Helper()
	e := newBkEnv(t)
	if err := e.settings.Set(context.Background(), models.SettingFeatureFileImportEnabled, "true"); err != nil {
		t.Fatal(err)
	}
	return &renameImportEnv{bkEnv: e, cols: repository.NewCollectionsRepo(e.conn)}
}

func (e *renameImportEnv) collection(name, folder string, parent *int64) int64 {
	e.t.Helper()
	id, err := e.cols.Create(context.Background(), &models.Collection{
		Name: name, RootPath: folder, ParentID: parent,
		DefaultQuality: "best", DefaultDownloadType: "video", FilenameTemplate: "{title}",
	})
	if err != nil {
		e.t.Fatalf("creating collection %q: %v", name, err)
	}
	return id
}

func (e *renameImportEnv) setFolder(id int64, folder string) {
	e.t.Helper()
	c, err := e.cols.Get(context.Background(), id)
	if err != nil {
		e.t.Fatal(err)
	}
	c.RootPath = folder
	if err := e.cols.Update(context.Background(), id, c); err != nil {
		e.t.Fatal(err)
	}
}

// trackedItem is a completed item whose file exists at rel and which sits in col.
func (e *renameImportEnv) trackedItem(title, rel string, col int64) int64 {
	e.t.Helper()
	writeFile(e.t, filepath.Join(e.mediaRoot, filepath.FromSlash(rel)))
	id, err := e.library.Create(context.Background(), &models.LibraryItem{
		Title: title, Filename: filepath.Base(rel), Path: rel, CollectionID: &col, Status: "completed",
	})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *renameImportEnv) scan() []ScannedFileResponse {
	e.t.Helper()
	w := e.send(http.MethodGet, "/api/import/scan", "", false)
	e.want(w, http.StatusOK)
	out := bkDecode[[]ScannedFileResponse](e.t, w)
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func (e *renameImportEnv) importFile(rel string) *httptest.ResponseRecorder {
	e.t.Helper()
	return e.post("/import", `{"path":"`+rel+`"}`)
}

// folderChains lists every collection as "folder-chain|name", sorted.
func (e *renameImportEnv) folderChains() []string {
	e.t.Helper()
	cols, err := e.cols.List(context.Background())
	if err != nil {
		e.t.Fatal(err)
	}
	byID := map[int64]models.Collection{}
	for _, c := range cols {
		byID[c.ID] = c
	}
	var out []string
	for _, c := range cols {
		var segs []string
		for cur := &c.ID; cur != nil; cur = byID[*cur].ParentID {
			segs = append([]string{byID[*cur].RootPath}, segs...)
		}
		out = append(out, strings.Join(segs, "/")+"|"+c.Name)
	}
	sort.Strings(out)
	return out
}

func equalStrings(a, b []string) bool { return strings.Join(a, "\n") == strings.Join(b, "\n") }

// (g1) An untracked file in a folder no collection's folder chain matches: the
// scan reports it with the part of the chain that is missing, and importing it
// creates exactly those collections (name = folder segment) and attaches the
// item. Existing prefixes are reused, not duplicated.
func TestImportScan_FolderWithoutCollectionCreatesOne(t *testing.T) {
	e := newRenameImportEnv(t)
	e.collection("Shows", "Shows", nil)
	writeFile(t, filepath.Join(e.mediaRoot, "Shows", "NewSeason", "ep.mp4"))
	writeFile(t, filepath.Join(e.mediaRoot, "Stray", "a.mp4"))

	got := e.scan()
	if len(got) != 2 {
		t.Fatalf("scan listed %d files, want 2: %+v", len(got), got)
	}
	if got[0].Path != "Shows/NewSeason/ep.mp4" || got[0].CollectionPath != "Shows/NewSeason" || got[0].NewCollectionPath != "NewSeason" {
		t.Fatalf("nested file: %+v", got[0])
	}
	if got[1].Path != "Stray/a.mp4" || got[1].CollectionPath != "Stray" || got[1].NewCollectionPath != "Stray" {
		t.Fatalf("top-level file: %+v", got[1])
	}

	e.want(e.importFile("Shows/NewSeason/ep.mp4"), http.StatusCreated)
	e.want(e.importFile("Stray/a.mp4"), http.StatusCreated)
	if want := []string{"Shows/NewSeason|NewSeason", "Shows|Shows", "Stray|Stray"}; !equalStrings(e.folderChains(), want) {
		t.Fatalf("collections = %v, want %v", e.folderChains(), want)
	}
	if again := e.scan(); len(again) != 0 {
		t.Fatalf("imported files must not be listed again: %+v", again)
	}
}

// (g2) After a collection's folder is renamed, a file that is still TRACKED in
// the old folder is NOT untracked: the scan matches files to library rows by
// their stored path, never by folder, so it is not listed, and the item stays
// in the renamed collection.
func TestImportScan_TrackedItemInOldFolderIsNotUntracked(t *testing.T) {
	e := newRenameImportEnv(t)
	concerts := e.collection("Concerts", "concerts", nil)
	id := e.trackedItem("Gig", "concerts/gig.mp4", concerts)
	e.setFolder(concerts, "live") // the file stays in concerts/

	if got := e.scan(); len(got) != 0 {
		t.Fatalf("a tracked file must not be listed after the folder rename: %+v", got)
	}
	item, err := e.library.Get(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if item.CollectionID == nil || *item.CollectionID != concerts || item.Path != "concerts/gig.mp4" {
		t.Fatalf("item must keep its collection and path, got %+v", item)
	}
}

// (g3) An UNTRACKED file sitting in the old folder after the rename (copied in
// by hand, or left over): nothing maps `concerts` to the renamed collection, so
// the scan offers it as "new collection concerts", and importing it creates a
// second collection named after the old folder.
//
// KNOWN LIMITATION: duplicates the renamed collection; the new one is created
// with defaults (not private, even if the renamed one is).
func TestImportScan_UntrackedFileInOldFolderCreatesDuplicate(t *testing.T) {
	e := newRenameImportEnv(t)
	concerts := e.collection("Concerts", "concerts", nil) // name differs from the folder
	e.trackedItem("Gig", "concerts/gig.mp4", concerts)
	e.setFolder(concerts, "live")
	writeFile(t, filepath.Join(e.mediaRoot, "concerts", "other.mp4"))

	got := e.scan()
	if len(got) != 1 || got[0].Path != "concerts/other.mp4" || got[0].NewCollectionPath != "concerts" {
		t.Fatalf("scan = %+v, want just concerts/other.mp4 as a new collection", got)
	}
	e.want(e.importFile("concerts/other.mp4"), http.StatusCreated)
	if want := []string{"concerts|concerts", "live|Concerts"}; !equalStrings(e.folderChains(), want) {
		t.Fatalf("collections = %v, want %v", e.folderChains(), want)
	}
}

// (g3b) Same, but the display name equals the old folder name. The create is
// refused (the renamed collection already has that name), and CreateImport does
// not swallow it like the bundle restore does: it answers 500 and imports
// nothing, so the file stays in the scan list forever.
//
// KNOWN LIMITATION: the file cannot be imported until the collection is renamed
// or the file moved; the scan list still offers it and the UI shows a failure.
func TestImportScan_UntrackedFileInOldFolderNameClash(t *testing.T) {
	e := newRenameImportEnv(t)
	pods := e.collection("Podcasts", "Podcasts", nil)
	e.setFolder(pods, "Pods")
	writeFile(t, filepath.Join(e.mediaRoot, "Podcasts", "p1.mp4"))

	got := e.scan()
	if len(got) != 1 || got[0].NewCollectionPath != "Podcasts" {
		t.Fatalf("scan = %+v", got)
	}
	w := e.importFile("Podcasts/p1.mp4")
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("import status = %d, want 500: %s", w.Code, w.Body)
	}
	if want := []string{"Pods|Podcasts"}; !equalStrings(e.folderChains(), want) {
		t.Fatalf("collections = %v, want %v", e.folderChains(), want)
	}
	if again := e.scan(); len(again) != 1 {
		t.Fatalf("the file must still be listed, got %+v", again)
	}
}

// (c, over HTTP) The same folder rename through the real endpoints: export the
// library, rename the folder, import the file. The handlers add nothing on top
// of backup.ApplyLibraryBundle, so the result matches the backup package test.
func TestLibraryBundleEndpoints_FolderRenamed(t *testing.T) {
	e := newRenameImportEnv(t)
	concerts := e.collection("Concerts", "concerts", nil)
	c, err := e.cols.Get(context.Background(), concerts)
	if err != nil {
		t.Fatal(err)
	}
	c.IsPrivate = true
	if err := e.cols.Update(context.Background(), concerts, c); err != nil {
		t.Fatal(err)
	}
	url := "https://example.com/gig"
	if _, err := e.library.Create(context.Background(), &models.LibraryItem{
		Title: "Gig", Filename: "gig.mp4", Path: "concerts/gig.mp4", CollectionID: &concerts, OriginalURL: &url, Status: "completed",
	}); err != nil {
		t.Fatal(err)
	}

	w := e.post("/backup/export/library", `{}`)
	e.want(w, http.StatusOK)
	file := w.Body.String()
	e.setFolder(concerts, "live")

	w = e.post("/backup/import/library", bkJSON(t, map[string]any{"data": file, "mode": "ghostOnly"}))
	e.want(w, http.StatusOK)

	if want := []string{"concerts|concerts", "live|Concerts"}; !equalStrings(e.folderChains(), want) {
		t.Fatalf("collections = %v, want %v", e.folderChains(), want)
	}
	cols, err := e.cols.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, col := range cols {
		// KNOWN LIMITATION: the private flag is lost on the new collection.
		if col.RootPath == "concerts" && col.IsPrivate {
			t.Fatalf("expected the new collection to be public, got %+v", col)
		}
		if col.RootPath == "live" && !col.IsPrivate {
			t.Fatalf("the renamed collection must stay private, got %+v", col)
		}
	}
	items, err := e.library.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	placed := map[string]string{}
	for _, it := range items {
		for _, col := range cols {
			if it.CollectionID != nil && col.ID == *it.CollectionID {
				placed[it.Status] = col.RootPath
			}
		}
	}
	if placed["completed"] != "live" || placed["ghost"] != "concerts" {
		t.Fatalf("placement = %v, want completed in live and the ghost in the new concerts", placed)
	}
}

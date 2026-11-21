package queue

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// A collection folder rename moves nothing on disk, so a redownload must
// write next to the item's existing file, not into the collection's current
// folder.

// renamedCollection creates a collection with root oldRoot and then renames
// its folder to newRoot in the DB only (files untouched), like the edit
// dialog does.
func (e *ghostEnv) renamedCollection(oldRoot, newRoot string) int64 {
	e.t.Helper()
	repo := repository.NewCollectionsRepo(e.conn)
	c := &models.Collection{Name: "Col", RootPath: oldRoot, DefaultQuality: "best", DefaultDownloadType: "video"}
	id, err := repo.Create(context.Background(), c)
	if err != nil {
		e.t.Fatal(err)
	}
	c.RootPath = newRoot
	if err := repo.Update(context.Background(), id, c); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *ghostEnv) addItemIn(col int64, title, rel string) int64 {
	e.t.Helper()
	id, err := e.library.Create(context.Background(), &models.LibraryItem{
		Title: title, Filename: filepath.Base(rel), Path: rel, Status: "completed", CollectionID: &col,
	})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *ghostEnv) abs(rel string) string { return filepath.Join(e.mediaRoot, filepath.FromSlash(rel)) }

func TestRedownloadAfterCollectionRenameReplacesFileInOldFolder(t *testing.T) {
	e := newGhostEnv(t)
	col := e.renamedCollection("Old Name", "New Name")
	item := e.addItemIn(col, "Same", "Old Name/Same.mp4")
	writeFile(t, e.abs("Old Name/Same.mp4"), "old")
	writeFile(t, e.abs("Old Name/Same.nfo"), "nfo")
	writeFile(t, e.abs("Old Name/Same.jpg"), "thumb")
	id := e.newDownload(models.Download{TargetLibraryItemID: &item, CollectionID: &col})
	e.mgr.runOne(context.Background(), id)

	if e.download(id).Status != models.StatusCompleted {
		t.Fatalf("status = %s", e.download(id).Status)
	}
	if got := readFile(t, e.abs("Old Name/Same.mp4")); got != "data\n" {
		t.Fatalf("file not replaced in place: %q", got)
	}
	for _, n := range []string{"Old Name/Same.nfo", "Old Name/Same.jpg"} {
		if !exists(e.abs(n)) {
			t.Errorf("%s must stay next to the file", n)
		}
	}
	if exists(e.abs("New Name")) {
		t.Fatal("nothing may be created in the renamed folder")
	}
	if exists(e.abs("Old Name/Same (2).mp4")) {
		t.Fatal("same-name redownload must not get a suffix")
	}
	it, _ := e.library.Get(context.Background(), item)
	if it.Path != "Old Name/Same.mp4" || it.Filename != "Same.mp4" {
		t.Fatalf("row = %+v", it)
	}
}

func TestRedownloadAfterCollectionRenameExtensionChange(t *testing.T) {
	e := newGhostEnv(t)
	col := e.renamedCollection("Old Name", "New Name")
	item := e.addItemIn(col, "Old", "Old Name/Old.webm")
	writeFile(t, e.abs("Old Name/Old.webm"), "old-bytes")
	id := e.newDownload(models.Download{TargetLibraryItemID: &item, CollectionID: &col})
	e.mgr.runOne(context.Background(), id)

	if exists(e.abs("Old Name/Old.webm")) || !exists(e.abs("Old Name/Old.mp4")) {
		t.Fatal("old file should be replaced by the new one in the item's own folder")
	}
	if exists(e.abs("New Name")) {
		t.Fatal("nothing may be created in the renamed folder")
	}
	it, _ := e.library.Get(context.Background(), item)
	if it.Path != "Old Name/Old.mp4" || e.download(id).Status != models.StatusCompleted {
		t.Fatalf("row = %+v", it)
	}
}

// A filename template with "/" puts the file in a subfolder that the item's
// Folder does not record; the redownload must still land beside the file.
func TestRedownloadKeepsTemplateSubfolderAfterCollectionRename(t *testing.T) {
	e := newGhostEnv(t)
	col := e.renamedCollection("Old Name", "New Name")
	item := e.addItemIn(col, "Ep", "Old Name/Season 1/Ep.mp4")
	writeFile(t, e.abs("Old Name/Season 1/Ep.mp4"), "old")
	id := e.newDownload(models.Download{TargetLibraryItemID: &item, CollectionID: &col})
	e.mgr.runOne(context.Background(), id)

	if got := readFile(t, e.abs("Old Name/Season 1/Ep.mp4")); got != "data\n" {
		t.Fatalf("file not replaced in its subfolder: %q", got)
	}
	if exists(e.abs("New Name")) || exists(e.abs("Old Name/Ep.mp4")) {
		t.Fatal("no file may appear outside the item's own directory")
	}
	it, _ := e.library.Get(context.Background(), item)
	if it.Path != "Old Name/Season 1/Ep.mp4" {
		t.Fatalf("row = %+v", it)
	}
}

func TestRedownloadGhostIsFilledIntoCurrentCollectionFolder(t *testing.T) {
	e := newGhostEnv(t)
	col := e.renamedCollection("Old Name", "New Name")
	ghost, err := e.library.Create(context.Background(), &models.LibraryItem{Title: "Ghost", Status: "ghost", CollectionID: &col})
	if err != nil {
		t.Fatal(err)
	}
	title := "Ghost"
	id := e.newDownload(models.Download{TargetLibraryItemID: &ghost, CollectionID: &col, OverrideTitle: &title})
	e.mgr.runOne(context.Background(), id)

	if got := readFile(t, e.abs("New Name/Ghost.mp4")); got != "data\n" {
		t.Fatalf("ghost not filled into the current folder: %q", got)
	}
	if exists(e.abs("Old Name")) {
		t.Fatal("the old folder must not be created for a ghost")
	}
	g, _ := e.library.Get(context.Background(), ghost)
	if g.Path != "New Name/Ghost.mp4" || g.Status != "completed" {
		t.Fatalf("row = %+v", g)
	}
}

func TestRedownloadFallsBackWhenItemDirectoryIsGone(t *testing.T) {
	e := newGhostEnv(t)
	col := e.renamedCollection("Old Name", "New Name")
	item := e.addItemIn(col, "Gone", "Old Name/Gone.mp4") // never written: directory absent
	id := e.newDownload(models.Download{TargetLibraryItemID: &item, CollectionID: &col})
	e.mgr.runOne(context.Background(), id)

	if e.download(id).Status != models.StatusCompleted {
		t.Fatalf("status = %s", e.download(id).Status)
	}
	if got := readFile(t, e.abs("New Name/Gone.mp4")); got != "data\n" {
		t.Fatalf("fallback file = %q", got)
	}
	if exists(e.abs("Old Name")) {
		t.Fatal("the missing old directory must not be re-created")
	}
	it, _ := e.library.Get(context.Background(), item)
	if it.Path != "New Name/Gone.mp4" {
		t.Fatalf("row = %+v", it)
	}
}

func TestRedownloadRefusesStoredPathOutsideMediaRoot(t *testing.T) {
	e := newGhostEnv(t)
	col := e.renamedCollection("Old Name", "New Name")
	item := e.addItemIn(col, "Evil", "../escape/Evil.mp4")
	id := e.newDownload(models.Download{TargetLibraryItemID: &item, CollectionID: &col})
	e.mgr.runOne(context.Background(), id)

	d := e.download(id)
	if d.Status != models.StatusFailed {
		t.Fatalf("status = %s, want failed", d.Status)
	}
	if d.ErrorMessage == nil || !strings.Contains(*d.ErrorMessage, "resolving target folder") {
		t.Fatalf("error = %v", d.ErrorMessage)
	}
	if _, err := os.Stat(filepath.Join(e.mediaRoot, "..", "escape")); err == nil {
		t.Fatal("something was written outside the media root")
	}
	if exists(e.abs("New Name")) {
		t.Fatal("no fallback write on a pathsafe violation")
	}
	it, _ := e.library.Get(context.Background(), item)
	if it.Path != "../escape/Evil.mp4" {
		t.Fatalf("row changed: %+v", it)
	}
}

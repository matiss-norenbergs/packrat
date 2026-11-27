package api

// Parallel POST /api/import through the real router, the way the Import page's
// "Import selected" / "Import all" fires it (every request at once). Every
// request must answer 201 or a legitimate 409; no 5xx, exactly one collection
// per folder and exactly one library row per file.

import (
	"fmt"
	"net/http"
	"path/filepath"
	"sync"
	"testing"
)

// importAllAtOnce posts one import per rel path concurrently and returns the
// status of each, keyed by path.
func (e *renameImportEnv) importAllAtOnce(rels []string) map[string]int {
	e.t.Helper()
	var mu sync.Mutex
	got := make(map[string]int, len(rels))
	var wg sync.WaitGroup
	start := make(chan struct{})
	for _, rel := range rels {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			w := e.importFile(rel)
			mu.Lock()
			got[rel] = w.Code
			if w.Code != http.StatusCreated && w.Code != http.StatusConflict {
				e.t.Errorf("import %s: status %d: %s", rel, w.Code, w.Body)
			}
			mu.Unlock()
		}()
	}
	close(start)
	wg.Wait()
	return got
}

// assertImported checks one library row per path and that every path got a 201
// (nothing here is imported twice, so a 409 would be wrong too).
func (e *renameImportEnv) assertImported(rels []string, statuses map[string]int) {
	e.t.Helper()
	for _, rel := range rels {
		if statuses[rel] != http.StatusCreated {
			e.t.Errorf("%s: status %d, want 201", rel, statuses[rel])
		}
		var n int
		if err := e.conn.QueryRow(`SELECT COUNT(*) FROM library WHERE path = ?`, rel).Scan(&n); err != nil || n != 1 {
			e.t.Errorf("%s: %d library rows (err %v), want 1", rel, n, err)
		}
	}
}

func (e *renameImportEnv) makeFiles(rels []string) {
	e.t.Helper()
	for _, rel := range rels {
		writeFile(e.t, filepath.Join(e.mediaRoot, filepath.FromSlash(rel)))
	}
}

// Many files under one folder that has no collection yet.
func TestParallelImport_OneNewFolder(t *testing.T) {
	e := newRenameImportEnv(t)
	var rels []string
	for i := 0; i < 24; i++ {
		rels = append(rels, fmt.Sprintf("Fresh/clip%02d.mp4", i))
	}
	e.makeFiles(rels)
	e.assertImported(rels, e.importAllAtOnce(rels))
	if want := []string{"Fresh|Fresh"}; !equalStrings(e.folderChains(), want) {
		t.Fatalf("collections = %v, want %v", e.folderChains(), want)
	}
}

// Many files, each in a folder of its own, plus a nested chain, plus files at
// the media root.
func TestParallelImport_ManyFoldersNestedAndRoot(t *testing.T) {
	e := newRenameImportEnv(t)
	var rels, want []string
	for i := 0; i < 16; i++ {
		rels = append(rels, fmt.Sprintf("Each%02d/clip.mp4", i))
		want = append(want, fmt.Sprintf("Each%02d|Each%02d", i, i))
	}
	for i := 0; i < 8; i++ {
		rels = append(rels, fmt.Sprintf("Deep/a/b/clip%d.mp4", i), fmt.Sprintf("root%d.mp4", i))
	}
	want = append(want, "Deep/a/b|b", "Deep/a|a", "Deep|Deep")
	e.makeFiles(rels)
	e.assertImported(rels, e.importAllAtOnce(rels))
	if got := e.folderChains(); len(got) != len(want) {
		t.Fatalf("collections = %v, want %d (%v)", got, len(want), want)
	}
}

// A folder whose name is already the display name of a collection with another
// folder (renamed, or made by hand) used to answer 500 for every file in it,
// while a file at the media root in the same batch succeeded.
func TestParallelImport_FolderNameTakenByRenamedCollection(t *testing.T) {
	e := newRenameImportEnv(t)
	pods := e.collection("Podcasts", "Podcasts", nil)
	e.setFolder(pods, "Pods")
	e.collection("Inner", "Inner", &pods)
	var rels []string
	for i := 0; i < 12; i++ {
		rels = append(rels, fmt.Sprintf("Podcasts/p%02d.mp4", i), fmt.Sprintf("Pods/Inner/q%02d.mp4", i))
	}
	rels = append(rels, "loose.mp4")
	e.makeFiles(rels)
	e.assertImported(rels, e.importAllAtOnce(rels))
	want := []string{"Podcasts|Podcasts (2)", "Pods/Inner|Inner", "Pods|Podcasts"}
	if got := e.folderChains(); !equalStrings(got, want) {
		t.Fatalf("collections = %v, want %v", got, want)
	}
	var n int
	if err := e.conn.QueryRow(`SELECT COUNT(*) FROM library l JOIN collections c ON c.id = l.collection_id WHERE c.name = 'Podcasts (2)'`).Scan(&n); err != nil || n != 12 {
		t.Fatalf("%d items in the new collection (err %v), want 12", n, err)
	}
}

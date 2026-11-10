package api

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"

	"packrat/backend/internal/models"
)

// library.path has no UNIQUE constraint, so the "already imported" check and the
// insert of an import are serialized by importMu. Overlapping requests for one
// file (a double click, Import Selected racing Import All) must create one row.
func TestConcurrentImportsOfOneFileCreateOneItem(t *testing.T) {
	e := newBkEnv(t)

	for round := 0; round < 25; round++ {
		path := "imports/clip" + string(rune('a'+round)) + ".mp4"
		var created, already atomic.Int32
		var wg sync.WaitGroup
		start := make(chan struct{})
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				item := models.LibraryItem{Title: "clip", Filename: "clip.mp4", Path: path, Status: "completed"}
				_, err := createImportedItem(t.Context(), e.library, &item)
				switch {
				case err == nil:
					created.Add(1)
				case errors.Is(err, errAlreadyImported):
					already.Add(1)
				default:
					t.Error(err)
				}
			}()
		}
		close(start)
		wg.Wait()
		if created.Load() != 1 || already.Load() != 7 {
			t.Fatalf("round %d (%s): %d created, %d refused; want 1 and 7", round, path, created.Load(), already.Load())
		}
		var n int
		if err := e.conn.QueryRow(`SELECT COUNT(*) FROM library WHERE path = ?`, path).Scan(&n); err != nil || n != 1 {
			t.Fatalf("round %d: %d library rows for %s (err %v), want 1", round, n, path, err)
		}
	}
}

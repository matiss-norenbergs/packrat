package api

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
	"testing"
)

// While a metadata remux (or another file operation) holds an item's lock,
// every request that would write, move or delete its media file answers 409
// and changes nothing.
func TestFileOperationsRefusedWhileItemLocked(t *testing.T) {
	e := newCleanupEnv(t)
	s := e.seedItem(t, "busy")
	other := e.seedItem(t, "free")
	locks := e.mgr.ItemLocks()
	if !locks.TryLock(s.id) {
		t.Fatal("could not lock item")
	}
	released := false
	release := func() {
		if !released {
			released = true
			locks.Unlock(s.id)
		}
	}
	defer release()

	cases := []struct {
		name, method, path, route, body string
		h                               func() gin.HandlerFunc
	}{
		{"delete with files", http.MethodDelete, fmt.Sprintf("/library/%d?deleteFiles=true", s.id), "/library/:id", "",
			func() gin.HandlerFunc {
				return DeleteLibraryItem(e.library, e.downloads, e.mgr, e.mediaRoot, e.imagesRoot)
			}},
		{"bulk delete with files", http.MethodPost, "/library/bulk-delete", "/library/bulk-delete",
			fmt.Sprintf(`{"itemIds":[%d,%d],"deleteFiles":true}`, other.id, s.id),
			func() gin.HandlerFunc {
				return BulkDeleteLibraryItems(e.conn, e.library, e.downloads, e.mgr, e.mediaRoot, e.imagesRoot)
			}},
		{"move", http.MethodPost, fmt.Sprintf("/library/%d/move", s.id), "/library/:id/move", `{"folder":"sub"}`,
			func() gin.HandlerFunc { return MoveLibraryItem(e.library, e.mgr, e.mediaRoot) }},
		{"trim accept", http.MethodPost, fmt.Sprintf("/library/%d/trim/accept", s.id), "/library/:id/trim/accept", `{"previewPath":".packrat-tmp/x.mp4"}`,
			func() gin.HandlerFunc { return AcceptLibraryItemTrim(e.library, e.mediaRoot, "", nil, nil, locks) }},
		{"delete file", http.MethodDelete, fmt.Sprintf("/library/%d/file", s.id), "/library/:id/file", "",
			func() gin.HandlerFunc {
				return DeleteLibraryItemFile(e.library, e.originals, locks, e.mediaRoot, e.imagesRoot)
			}},
		{"bulk delete file", http.MethodPost, "/library/bulk-delete-file", "/library/bulk-delete-file",
			fmt.Sprintf(`{"itemIds":[%d,%d]}`, other.id, s.id),
			func() gin.HandlerFunc {
				return BulkDeleteLibraryItemFiles(e.conn, e.library, e.downloads, e.originals, locks, e.mediaRoot, e.imagesRoot)
			}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := e.do(t, tc.h(), tc.method, tc.path, tc.route, tc.body)
			if w.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409: %s", w.Code, w.Body)
			}
			if !strings.Contains(w.Body.String(), itemBusyMessage) {
				t.Fatalf("body = %s, want busy message", w.Body)
			}
			// Nothing changed — including the unlocked item sharing a bulk request.
			assertPresent(t, s.media, s.nfo, s.thumb, other.media, other.nfo, other.thumb)
			it, err := e.library.Get(t.Context(), s.id)
			if err != nil || it.Path != "busy.mp4" || it.Filename != "busy.mp4" || it.Title != "busy" {
				t.Fatalf("row changed: %+v err=%v", it, err)
			}
			if o, err := e.library.Get(t.Context(), other.id); err != nil || o.Path == "" {
				t.Fatalf("unlocked item changed by a refused bulk request: %+v err=%v", o, err)
			}
		})
	}

	// Deleting just the row (no file operation) is not blocked by the lock.
	w := e.do(t, DeleteLibraryItem(e.library, e.downloads, e.mgr, e.mediaRoot, e.imagesRoot), http.MethodDelete,
		fmt.Sprintf("/library/%d", other.id), "/library/:id", "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("row-only delete of an unlocked item: %d", w.Code)
	}

	// Once the lock is released the same request goes through.
	release()
	w = e.do(t, DeleteLibraryItem(e.library, e.downloads, e.mgr, e.mediaRoot, e.imagesRoot), http.MethodDelete,
		fmt.Sprintf("/library/%d?deleteFiles=true", s.id), "/library/:id", "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("after release: %d: %s", w.Code, w.Body)
	}
	assertGone(t, s.media)
	if locks.Len() != 0 {
		t.Fatalf("lock entries leaked: %d", locks.Len())
	}
}

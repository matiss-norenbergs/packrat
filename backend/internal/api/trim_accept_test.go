package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/itemlock"
	"packrat/backend/internal/models"
)

// seedTrimItem creates a completed item with a media file and a duration.
func (e *cleanupEnv) seedTrimItem(t *testing.T, name string, duration int) int64 {
	t.Helper()
	writeFile(t, filepath.Join(e.mediaRoot, name+".mp4"))
	d := duration
	id, err := e.library.Create(context.Background(), &models.LibraryItem{
		Title: name, Filename: name + ".mp4", Path: name + ".mp4", Status: "completed", Duration: &d,
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func (e *cleanupEnv) acceptTrim(t *testing.T, id int64, ffprobePath, previewPath string) *httptest.ResponseRecorder {
	t.Helper()
	h := AcceptLibraryItemTrim(e.library, e.mediaRoot, ffprobePath, &downloader.YtDlpService{}, e.responder(), itemlock.New())
	return e.do(t, h, http.MethodPost, fmt.Sprintf("/library/%d/trim/accept", id), "/library/:id/trim/accept",
		fmt.Sprintf(`{"previewPath":%q}`, previewPath))
}

// When ffprobe cannot read the trimmed file, the stored duration must become
// NULL ("unknown") rather than 0 — a 0 s duration would show as "0:00" and
// break the "resume near the end" logic.
func TestAcceptTrimProbeFailureStoresNullDuration(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := newCleanupEnv(t)
	id := e.seedTrimItem(t, "vid", 120)

	rel := e.seedPreview(t, "vid", id)

	w := e.acceptTrim(t, id, filepath.Join(t.TempDir(), "no-such-ffprobe"), rel)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	var isNull bool
	if err := e.conn.QueryRow(`SELECT duration IS NULL FROM library WHERE id = ?`, id).Scan(&isNull); err != nil {
		t.Fatal(err)
	}
	if !isNull {
		var d int
		_ = e.conn.QueryRow(`SELECT duration FROM library WHERE id = ?`, id).Scan(&d)
		t.Fatalf("duration = %d after a failed probe, want NULL", d)
	}
}

// seedPreview writes a preview file named the way BuildTrimPreview names it
// for item id, and returns its MediaRoot-relative path.
func (e *cleanupEnv) seedPreview(t *testing.T, base string, id int64) string {
	t.Helper()
	name := fmt.Sprintf("%s.trim-preview-%d-abc.mp4", base, id)
	abs := filepath.Join(downloader.TrimTmpDir(e.mediaRoot), name)
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, []byte("trimmed"), 0o644); err != nil {
		t.Fatal(err)
	}
	return filepath.ToSlash(filepath.Join(filepath.Base(downloader.TrimTmpDir(e.mediaRoot)), name))
}

// A preview is bound to the item it was cut from: Accept and Discard with
// another item's preview are refused (400) and nothing changes; the item's own
// preview still works.
func TestTrimPreviewIsBoundToItsItem(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := newCleanupEnv(t)
	a := e.seedTrimItem(t, "a", 100)
	b := e.seedTrimItem(t, "b", 200)
	previewA := e.seedPreview(t, "a", a)
	previewB := e.seedPreview(t, "b", b)

	discard := func(id int64, preview string) int {
		h := DiscardLibraryItemTrim(e.mediaRoot, &downloader.YtDlpService{})
		return e.do(t, h, http.MethodPost, fmt.Sprintf("/library/%d/trim/discard", id), "/library/:id/trim/discard",
			fmt.Sprintf(`{"previewPath":%q}`, preview)).Code
	}
	mediaBefore, _ := os.ReadFile(filepath.Join(e.mediaRoot, "a.mp4"))

	// Accept item A with B's preview: refused, A's file and both previews untouched.
	if w := e.acceptTrim(t, a, "", previewB); w.Code != http.StatusBadRequest {
		t.Fatalf("accept with another item's preview: status %d, want 400: %s", w.Code, w.Body)
	}
	if got, _ := os.ReadFile(filepath.Join(e.mediaRoot, "a.mp4")); string(got) != string(mediaBefore) {
		t.Fatal("item A's media file was overwritten by another item's preview")
	}
	// Discard B's preview from A's route: refused, the file stays.
	if code := discard(a, previewB); code != http.StatusBadRequest {
		t.Fatalf("discard with another item's preview: status %d, want 400", code)
	}
	if !exists(filepath.Join(e.mediaRoot, filepath.FromSlash(previewB))) || !exists(filepath.Join(e.mediaRoot, filepath.FromSlash(previewA))) {
		t.Fatal("a refused request removed a preview")
	}
	// A preview without an item id (the older naming) is refused too.
	legacy := filepath.Join(downloader.TrimTmpDir(e.mediaRoot), "a.trim-preview-xyz.mp4")
	writeFile(t, legacy)
	if code := discard(a, ".packrat-tmp/a.trim-preview-xyz.mp4"); code != http.StatusBadRequest {
		t.Fatalf("discard of an id-less preview: status %d, want 400", code)
	}

	// The normal flow still works: discard A's own preview, then accept B's own.
	if code := discard(a, previewA); code != http.StatusNoContent {
		t.Fatalf("discard own preview: status %d, want 204", code)
	}
	if exists(filepath.Join(e.mediaRoot, filepath.FromSlash(previewA))) {
		t.Fatal("own preview was not removed")
	}
	if w := e.acceptTrim(t, b, "", previewB); w.Code != http.StatusOK {
		t.Fatalf("accept own preview: status %d: %s", w.Code, w.Body)
	}
	if got, _ := os.ReadFile(filepath.Join(e.mediaRoot, "b.mp4")); string(got) != "trimmed" {
		t.Fatalf("item B's file = %q, want the accepted preview", got)
	}
	if exists(filepath.Join(e.mediaRoot, filepath.FromSlash(previewB))) {
		t.Fatal("accepted preview should have been consumed")
	}
}

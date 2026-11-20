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

	preview := filepath.Join(downloader.TrimTmpDir(e.mediaRoot), "vid.trim-preview-abc.mp4")
	if err := os.MkdirAll(filepath.Dir(preview), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preview, []byte("not a real video"), 0o644); err != nil {
		t.Fatal(err)
	}

	w := e.acceptTrim(t, id, filepath.Join(t.TempDir(), "no-such-ffprobe"), ".packrat-tmp/vid.trim-preview-abc.mp4")
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

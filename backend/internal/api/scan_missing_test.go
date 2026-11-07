package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
)

type scanResult struct {
	code int
	body map[string]any
}

func (e *cleanupEnv) scan(t *testing.T, mediaRoot, body string) scanResult {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/scan", ScanMissingLibraryFiles(mediaRoot, e.library))
	var req *http.Request
	if body == "<none>" {
		req = httptest.NewRequest(http.MethodPost, "/scan", nil)
	} else {
		req = httptest.NewRequest(http.MethodPost, "/scan", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	res := scanResult{code: w.Code, body: map[string]any{}}
	if err := json.Unmarshal(w.Body.Bytes(), &res.body); err != nil {
		t.Fatalf("response is not JSON (%d): %s", w.Code, w.Body.String())
	}
	return res
}

// item creates a completed library item at path (relative to the media root); the file is only
// written when present is true.
func (e *cleanupEnv) item(t *testing.T, path string, present bool) int64 {
	t.Helper()
	id, err := e.library.Create(context.Background(), &models.LibraryItem{
		Title: path, Filename: filepath.Base(path), Path: path, Status: "completed",
	})
	if err != nil {
		t.Fatal(err)
	}
	if present {
		writeFile(t, filepath.Join(e.mediaRoot, filepath.FromSlash(path)))
	}
	return id
}

func (e *cleanupEnv) isGhost(t *testing.T, id int64) bool {
	t.Helper()
	item, err := e.library.Get(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return item.Path == "" && item.Status == "ghost"
}

func num(t *testing.T, m map[string]any, key string) int {
	t.Helper()
	v, ok := m[key].(float64)
	if !ok {
		t.Fatalf("response has no numeric %q: %v", key, m)
	}
	return int(v)
}

func TestScanMissingSmallScanBehavesAsBefore(t *testing.T) {
	for _, body := range []string{"<none>", "", "  \n", "{}", `{"confirm":false}`} {
		e := newCleanupEnv(t)
		keep := e.item(t, "keep.mp4", true)
		gone := e.item(t, "gone.mp4", false)

		res := e.scan(t, e.mediaRoot, body)
		if res.code != http.StatusOK {
			t.Fatalf("body %q: status %d: %v", body, res.code, res.body)
		}
		if num(t, res.body, "scanned") != 2 || num(t, res.body, "unreadable") != 0 {
			t.Fatalf("body %q: %v", body, res.body)
		}
		if missing, _ := res.body["missing"].([]any); len(missing) != 1 {
			t.Fatalf("body %q: missing = %v", body, res.body["missing"])
		}
		if e.isGhost(t, keep) || !e.isGhost(t, gone) {
			t.Fatalf("body %q: keep ghost=%v gone ghost=%v", body, e.isGhost(t, keep), e.isGhost(t, gone))
		}
	}
}

func TestScanMissingMalformedBodyIs400(t *testing.T) {
	e := newCleanupEnv(t)
	e.item(t, "keep.mp4", true)
	if res := e.scan(t, e.mediaRoot, "{nope"); res.code != http.StatusBadRequest {
		t.Fatalf("status %d: %v", res.code, res.body)
	}
}

// A stat error that is not "does not exist" proves nothing about the file: leave the item alone.
func TestScanMissingUnreadableIsNotCleared(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs POSIX permissions and a non-root user")
	}
	e := newCleanupEnv(t)
	e.item(t, "keep.mp4", true)
	writeFile(t, filepath.Join(e.mediaRoot, "locked", "a.mp4"))
	locked := e.item(t, "locked/a.mp4", false) // file exists, but its folder cannot be searched
	gone := e.item(t, "gone.mp4", false)
	if err := os.Chmod(filepath.Join(e.mediaRoot, "locked"), 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(filepath.Join(e.mediaRoot, "locked"), 0o755) })

	res := e.scan(t, e.mediaRoot, "<none>")
	if res.code != http.StatusOK {
		t.Fatalf("status %d: %v", res.code, res.body)
	}
	if num(t, res.body, "unreadable") != 1 || num(t, res.body, "scanned") != 3 {
		t.Fatalf("response: %v", res.body)
	}
	if e.isGhost(t, locked) {
		t.Fatal("an unreadable item was converted to a ghost")
	}
	if !e.isGhost(t, gone) {
		t.Fatal("the genuinely missing item was not converted")
	}
}

func TestScanMissingRefusesMissingOrEmptyMediaRoot(t *testing.T) {
	e := newCleanupEnv(t)
	id := e.item(t, "a.mp4", false)

	for name, root := range map[string]string{
		"empty media root":   e.mediaRoot, // nothing written there
		"missing media root": filepath.Join(e.mediaRoot, "not-mounted"),
	} {
		res := e.scan(t, root, "<none>")
		if res.code != http.StatusConflict {
			t.Fatalf("%s: status %d: %v", name, res.code, res.body)
		}
		if msg, _ := res.body["error"].(string); !strings.Contains(msg, "media folder") {
			t.Fatalf("%s: unhelpful message %q", name, msg)
		}
		if res.body["requiresConfirm"] != nil {
			t.Fatalf("%s: a missing mount must not be confirmable: %v", name, res.body)
		}
		if e.isGhost(t, id) {
			t.Fatalf("%s: the item was cleared", name)
		}
	}
	// Even an explicit confirm cannot override an unmounted folder.
	if res := e.scan(t, e.mediaRoot, `{"confirm":true}`); res.code != http.StatusConflict || e.isGhost(t, id) {
		t.Fatalf("confirm overrode the media-root check: %d %v", res.code, res.body)
	}
}

func TestScanMissingNoItemsWithEmptyRootIsFine(t *testing.T) {
	e := newCleanupEnv(t)
	res := e.scan(t, e.mediaRoot, "<none>")
	if res.code != http.StatusOK || num(t, res.body, "scanned") != 0 {
		t.Fatalf("%d %v", res.code, res.body)
	}
}

func TestScanMissingMassClearNeedsConfirm(t *testing.T) {
	e := newCleanupEnv(t)
	e.item(t, "keep1.mp4", true)
	e.item(t, "keep2.mp4", true)
	var gone []int64
	for i := 0; i < 10; i++ { // 10 of 12 = over 50% and at least 10
		gone = append(gone, e.item(t, fmt.Sprintf("gone%d.mp4", i), false))
	}

	res := e.scan(t, e.mediaRoot, "<none>")
	if res.code != http.StatusConflict || res.body["requiresConfirm"] != true {
		t.Fatalf("expected a confirmable 409, got %d %v", res.code, res.body)
	}
	if num(t, res.body, "scanned") != 12 || num(t, res.body, "wouldClear") != 10 {
		t.Fatalf("counts: %v", res.body)
	}
	for _, id := range gone {
		if e.isGhost(t, id) {
			t.Fatal("the guard returned 409 but still cleared an item")
		}
	}

	res = e.scan(t, e.mediaRoot, `{"confirm":true}`)
	if res.code != http.StatusOK || len(res.body["missing"].([]any)) != 10 {
		t.Fatalf("confirmed scan: %d %v", res.code, res.body)
	}
	for _, id := range gone {
		if !e.isGhost(t, id) {
			t.Fatal("confirmed scan left a missing item alone")
		}
	}
}

func TestScanMissingGuardThresholds(t *testing.T) {
	// 9 missing out of 9: all gone, but under the 10-item floor.
	e := newCleanupEnv(t)
	writeFile(t, filepath.Join(e.mediaRoot, "other.txt")) // keep the media root non-empty
	for i := 0; i < 9; i++ {
		e.item(t, fmt.Sprintf("gone%d.mp4", i), false)
	}
	if res := e.scan(t, e.mediaRoot, "<none>"); res.code != http.StatusOK || len(res.body["missing"].([]any)) != 9 {
		t.Fatalf("9/9: %d %v", res.code, res.body)
	}

	// 10 missing out of 25: at least 10 but under half.
	e = newCleanupEnv(t)
	for i := 0; i < 15; i++ {
		e.item(t, fmt.Sprintf("keep%d.mp4", i), true)
	}
	for i := 0; i < 10; i++ {
		e.item(t, fmt.Sprintf("gone%d.mp4", i), false)
	}
	if res := e.scan(t, e.mediaRoot, "<none>"); res.code != http.StatusOK || len(res.body["missing"].([]any)) != 10 {
		t.Fatalf("10/25: %d %v", res.code, res.body)
	}
}

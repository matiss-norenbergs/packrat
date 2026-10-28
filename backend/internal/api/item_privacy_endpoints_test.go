package api

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/repository"
)

// Endpoints that write an item and answer with it. Each is checked with
// privacy off and on against an item under a private parent collection (the
// child itself isn't private) and an item with a private tag.
//
// Not covered here: POST /library/:id/refresh-metadata (needs yt-dlp +
// network), trim accept (needs a real trim preview) and the gallery-apply /
// frame-match-accept thumbnail endpoints (need gallery / queue rows). They
// all end in the same ItemResponder.Response call that the endpoints below
// and TestItemResponderBlurred exercise; the thumbnail ones also share
// writeThumbnailAndRespond with SetLibraryThumbnail.

func requireFFmpeg(t *testing.T) {
	t.Helper()
	for _, bin := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(bin); err != nil {
			t.Skipf("%s not installed", bin)
		}
	}
}

func TestCreateGhostBlurred(t *testing.T) {
	f := newPrivacyFixture(t)
	s := f.scenario()
	mount := func(r *gin.Engine) {
		r.POST("/api/library/ghost", CreateGhostLibraryItem(f.library, f.mediaRoot, nil, f.tags, f.responder()))
	}

	cases := []struct {
		name string
		body map[string]any
		on   bool // blurred expected when privacy is on
	}{
		{"private parent collection", map[string]any{"title": "a", "mediaType": "video", "collectionId": s.child}, true},
		{"private tag", map[string]any{"title": "b", "mediaType": "video", "tags": []string{"secret"}}, true},
		{"plain", map[string]any{"title": "c", "mediaType": "video", "tags": []string{"x"}}, false},
	}
	for _, on := range []bool{false, true} {
		f.setPrivacy(on)
		for _, tc := range cases {
			t.Run(fmt.Sprintf("privacy=%v/%s", on, tc.name), func(t *testing.T) {
				var got LibraryItemResponse
				w := serveJSON(t, mount, http.MethodPost, "/api/library/ghost", tc.body, &got)
				if w.Code != http.StatusCreated {
					t.Fatalf("status %d: %s", w.Code, w.Body.String())
				}
				if want := on && tc.on; got.Blurred != want {
					t.Fatalf("blurred = %v, want %v", got.Blurred, want)
				}
			})
		}
	}
}

func TestSetLibraryThumbnailBlurred(t *testing.T) {
	requireFFmpeg(t)
	f := newPrivacyFixture(t)
	s := f.scenario()
	conn := f.conn
	imagesRoot := t.TempDir()

	png := filepath.Join(t.TempDir(), "in.png")
	if out, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", png).CombinedOutput(); err != nil {
		t.Fatalf("generating test image: %v: %s", err, out)
	}
	raw, err := os.ReadFile(png)
	if err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"imageBase64": base64.StdEncoding.EncodeToString(raw)}

	mount := func(r *gin.Engine) {
		r.POST("/api/library/:id/thumbnail", SetLibraryThumbnail(f.mediaRoot, imagesRoot, "ffmpeg", f.library, f.responder(), repository.NewThumbnailEnhancementOriginalsRepo(conn)))
	}
	want := map[int64]bool{s.inPrivateParent: true, s.privateTagged: true, s.plain: false}
	for _, on := range []bool{false, true} {
		f.setPrivacy(on)
		for id, blurred := range want {
			t.Run(fmt.Sprintf("privacy=%v/item=%d", on, id), func(t *testing.T) {
				var got LibraryItemResponse
				w := serveJSON(t, mount, http.MethodPost, fmt.Sprintf("/api/library/%d/thumbnail", id), body, &got)
				if w.Code != http.StatusOK {
					t.Fatalf("status %d: %s", w.Code, w.Body.String())
				}
				if got.Blurred != (on && blurred) {
					t.Fatalf("blurred = %v, want %v", got.Blurred, on && blurred)
				}
			})
		}
	}
}

func TestCreateImportBlurred(t *testing.T) {
	requireFFmpeg(t)
	f := newPrivacyFixture(t)
	f.scenario() // collections "parent" (private) > "child"

	writeWav := func(rel string) {
		abs := filepath.Join(f.mediaRoot, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if out, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=1", abs).CombinedOutput(); err != nil {
			t.Fatalf("generating %s: %v: %s", rel, err, out)
		}
	}
	mount := func(r *gin.Engine) {
		r.POST("/api/import", CreateImport(f.mediaRoot, t.TempDir(), f.library, f.collections, &downloader.YtDlpService{FFmpegPath: "ffmpeg"}, "ffprobe", f.responder()))
	}

	n := 0
	for _, on := range []bool{false, true} {
		f.setPrivacy(on)
		for _, tc := range []struct {
			name, dir string
			blurred   bool
		}{
			{"under private parent", "parent/child", true},
			{"plain folder", "other", false},
		} {
			n++
			t.Run(fmt.Sprintf("privacy=%v/%s", on, tc.name), func(t *testing.T) {
				rel := fmt.Sprintf("%s/f%d.wav", tc.dir, n)
				writeWav(rel)
				var got LibraryItemResponse
				w := serveJSON(t, mount, http.MethodPost, "/api/import", map[string]any{"path": rel}, &got)
				if w.Code != http.StatusCreated {
					t.Fatalf("status %d: %s", w.Code, w.Body.String())
				}
				if got.Blurred != (on && tc.blurred) {
					t.Fatalf("blurred = %v, want %v", got.Blurred, on && tc.blurred)
				}
			})
		}
	}
}

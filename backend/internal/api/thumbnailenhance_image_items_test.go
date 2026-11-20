package api

import (
	"bytes"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/bgtasks"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/thumbnailenhance"
)

// imageEnhanceFixture has one video and one image item (both with a small,
// not-yet-probed thumbnail record) and an "upscaler" that only counts requests.
type imageEnhanceFixture struct {
	*privacyFixture
	deps          thumbnailenhance.Deps
	videoID       int64
	imageID       int64
	upscalerCalls *atomic.Int32
}

func newImageEnhanceFixture(t *testing.T) *imageEnhanceFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	f := &imageEnhanceFixture{privacyFixture: newPrivacyFixture(t), upscalerCalls: new(atomic.Int32)}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.upscalerCalls.Add(1)
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	t.Cleanup(srv.Close)
	for k, v := range map[string]string{
		models.SettingThumbnailEnhancementEnabled: "true",
		models.SettingThumbnailEnhancementURL:     srv.URL,
	} {
		if err := f.settings.Set(f.ctx, k, v); err != nil {
			t.Fatal(err)
		}
	}
	f.deps = thumbnailenhance.Deps{
		SettingsRepo:  f.settings,
		LibraryRepo:   f.library,
		HistoryRepo:   repository.NewThumbnailEnhancementHistoryRepo(f.conn),
		OriginalsRepo: repository.NewThumbnailEnhancementOriginalsRepo(f.conn),
		MediaRoot:     f.mediaRoot,
		ImagesRoot:    t.TempDir(),
	}
	f.videoID = f.item("video", nil)
	f.imageID = f.item("image", nil)
	if _, err := f.conn.ExecContext(f.ctx, `UPDATE library SET media_type='video', thumbnail='video.jpg', thumbnail_width=100, thumbnail_height=100 WHERE id=?`, f.videoID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.conn.ExecContext(f.ctx, `UPDATE library SET media_type='image', filename='image.png', path='image.png', thumbnail='image.png', thumbnail_width=100, thumbnail_height=100 WHERE id=?`, f.imageID); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *imageEnhanceFixture) post(h gin.HandlerFunc, body string) *httptest.ResponseRecorder {
	r := gin.New()
	r.POST("/x", h)
	req := httptest.NewRequest("POST", "/x", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestEnhanceAndSharpenRefuseASingleImageItem(t *testing.T) {
	f := newImageEnhanceFixture(t)
	runner := bgtasks.Runner{Tracker: &bgtasks.Tracker{}}
	for name, h := range map[string]gin.HandlerFunc{
		"enhance": EnhanceThumbnailItemsNow(f.deps, runner),
		"sharpen": SharpenThumbnailItemsNow(f.deps, runner),
	} {
		w := f.post(h, `{"itemIds":[`+itoa(f.imageID)+`]}`)
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), errImageItemThumbnail) {
			t.Errorf("%s: %d %s, want 400 naming the image file", name, w.Code, w.Body.String())
		}
	}
	runner.Tracker.Wait(5 * time.Second)
	if f.upscalerCalls.Load() != 0 {
		t.Error("the upscaler was called")
	}
}

func TestBulkEnhanceAndSharpenSkipImageItems(t *testing.T) {
	f := newImageEnhanceFixture(t)
	runner := bgtasks.Runner{Tracker: &bgtasks.Tracker{}}
	body := `{"itemIds":[` + itoa(f.videoID) + `,` + itoa(f.imageID) + `]}`
	for name, h := range map[string]gin.HandlerFunc{
		"enhance": EnhanceThumbnailItemsNow(f.deps, runner),
		"sharpen": SharpenThumbnailItemsNow(f.deps, runner),
	} {
		w := f.post(h, body)
		if w.Code != http.StatusAccepted || !strings.Contains(w.Body.String(), `"queued":1`) || !strings.Contains(w.Body.String(), `"skipped":1`) {
			t.Errorf("%s: %d %s, want 202 queued 1 skipped 1", name, w.Code, w.Body.String())
		}
	}
	// Only image items: nothing is queued at all.
	w := f.post(EnhanceThumbnailItemsNow(f.deps, runner), `{"itemIds":[`+itoa(f.imageID)+`,`+itoa(f.imageID)+`]}`)
	if w.Code != http.StatusAccepted || !strings.Contains(w.Body.String(), `"queued":0`) || !strings.Contains(w.Body.String(), `"skipped":2`) {
		t.Errorf("all-image bulk: %d %s", w.Code, w.Body.String())
	}
	runner.Tracker.Wait(5 * time.Second)
}

func TestEnhanceNowCountAndEligiblePreviewExcludeImageItems(t *testing.T) {
	f := newImageEnhanceFixture(t)
	// The video's thumbnail file must exist to be probed as eligible; the image's
	// file exists too, so only the exclusion keeps it out.
	writeSmallPNG(t, f.mediaRoot, "video.jpg")
	writeSmallPNG(t, f.mediaRoot, "image.png")

	runner := bgtasks.Runner{Tracker: &bgtasks.Tracker{}}
	r := gin.New()
	r.POST("/now", RunThumbnailEnhancementNow(f.deps, runner))
	r.GET("/eligible", ListThumbnailEnhancementEligible(f.deps))

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/eligible", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"itemTitle":"video"`) || strings.Contains(w.Body.String(), `"itemTitle":"image"`) {
		t.Errorf("eligible preview: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("POST", "/now", nil))
	if w.Code != http.StatusAccepted || !strings.Contains(w.Body.String(), `"queued":1`) {
		t.Errorf("Enhance Now: %d %s, want queued 1 (the video only)", w.Code, w.Body.String())
	}
	runner.Tracker.Wait(5 * time.Second)
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func writeSmallPNG(t *testing.T, dir, name string) {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 8, 8))); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

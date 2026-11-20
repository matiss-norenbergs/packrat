package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"math/rand"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/thumbwrite"
)

// useRealJPEGConversion points thumbwrite's conversion seam at the machine's ffmpeg (the swEnv
// ffmpeg is a fake that only writes tiers). Skips without ffmpeg.
func useRealJPEGConversion(t *testing.T) {
	t.Helper()
	real, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	old := thumbwrite.ConvertToJPEG
	thumbwrite.ConvertToJPEG = func(ctx context.Context, _ string, data []byte) ([]byte, error) {
		return imageproc.BytesToJPEG(ctx, real, data)
	}
	t.Cleanup(func() { thumbwrite.ConvertToJPEG = old })
}

// photoLikePNG is a deterministic gradient-plus-noise image that compresses like a photo, not
// like a flat colour.
func photoLikePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	rng := rand.New(rand.NewSource(1))
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			n := rng.Intn(24) - 12
			c := func(v float64) uint8 { return uint8(math.Max(0, math.Min(255, v+float64(n)))) }
			img.SetRGBA(x, y, color.RGBA{
				R: c(128 + 100*math.Sin(float64(x)/90)),
				G: c(128 + 100*math.Sin(float64(y)/70+float64(x)/200)),
				B: c(128 + 100*math.Cos(float64(x+y)/130)),
				A: 255,
			})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func assertSidecarIsJPEG(t *testing.T, e *swEnv, body []byte, w, h int) []byte {
	t.Helper()
	got, err := os.ReadFile(e.thumbAbs)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(got, []byte{0xFF, 0xD8, 0xFF}) {
		t.Fatalf("sidecar starts with % x, want FF D8 FF", got[:4])
	}
	var resp struct {
		ThumbnailWidth  *int `json:"thumbnailWidth"`
		ThumbnailHeight *int `json:"thumbnailHeight"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatal(err)
	}
	if resp.ThumbnailWidth == nil || *resp.ThumbnailWidth != w || *resp.ThumbnailHeight != h {
		t.Errorf("response dimensions = %v x %v, want %dx%d", resp.ThumbnailWidth, resp.ThumbnailHeight, w, h)
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(got))
	if err != nil || format != "jpeg" || cfg.Width != w || cfg.Height != h {
		t.Errorf("sidecar decodes as %s %dx%d (err %v)", format, cfg.Width, cfg.Height, err)
	}
	return got
}

func TestSetThumbnailWithAPNGLeavesAJPEGSidecar(t *testing.T) {
	useRealJPEGConversion(t)
	e := newSWEnv(t)
	data := photoLikePNG(t, 1920, 1080)
	h := SetLibraryThumbnail(e.mediaRoot, e.imagesRoot, e.fakeFFmpeg(e.newBytes, false), e.library, e.responder(), e.originals, e.mgr.ItemLocks())
	w := e.do(t, h, http.MethodPost, fmt.Sprintf("/library/%d/thumbnail", e.id), "/library/:id/thumbnail",
		fmt.Sprintf(`{"imageBase64":%q}`, base64.StdEncoding.EncodeToString(data)))
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	got := assertSidecarIsJPEG(t, e, w.Body.Bytes(), 1920, 1080)
	t.Logf("MEASURE 1920x1080 photo-like PNG: %d bytes -> JPEG sidecar %d bytes", len(data), len(got))
}

func TestGalleryApplyOfAPNGGalleryImageLeavesAJPEGSidecar(t *testing.T) {
	useRealJPEGConversion(t)
	e := newSWEnv(t)
	data := pngBytesOf(t, 40, 30)
	gal := repository.NewThumbnailGalleryRepo(e.conn)
	rel := fmt.Sprintf("thumbnail-gallery/%d/g.png", e.id)
	abs := filepath.Join(e.imagesRoot, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, data, 0o644); err != nil {
		t.Fatal(err)
	}
	gid, err := gal.Create(context.Background(), e.id, rel, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	h := ApplyLibraryThumbnailFromGallery(e.mediaRoot, e.imagesRoot, e.fakeFFmpeg(e.newBytes, false), e.library, gal, e.responder(), e.originals, e.mgr.ItemLocks())
	w := e.do(t, h, http.MethodPost, fmt.Sprintf("/library/%d/thumbnail/gallery/%d/apply", e.id, gid), "/library/:id/thumbnail/gallery/:galleryId/apply", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	assertSidecarIsJPEG(t, e, w.Body.Bytes(), 40, 30)
	if kept, _ := os.ReadFile(abs); !bytes.Equal(kept, data) {
		t.Error("the gallery copy must keep its original format")
	}
}

func pngBytesOf(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(x * 6), G: uint8(y * 8), B: 70, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

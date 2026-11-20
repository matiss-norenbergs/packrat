package thumbwrite

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"testing"

	"packrat/backend/internal/imageproc"
)

// useRealConversion points the seam at the machine's ffmpeg (the fixture's own ffmpeg is a fake
// that only writes .webp tiers). Skips without ffmpeg.
func useRealConversion(t *testing.T) {
	t.Helper()
	real, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	old := ConvertToJPEG
	ConvertToJPEG = func(ctx context.Context, _ string, data []byte) ([]byte, error) {
		return imageproc.BytesToJPEG(ctx, real, data)
	}
	t.Cleanup(func() { ConvertToJPEG = old })
}

func failConversion(t *testing.T, calls *int) {
	t.Helper()
	old := ConvertToJPEG
	ConvertToJPEG = func(context.Context, string, []byte) ([]byte, error) {
		*calls++
		return nil, errors.New("ffmpeg exploded")
	}
	t.Cleanup(func() { ConvertToJPEG = old })
}

func jpegData(t *testing.T, size int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 9), G: uint8(y * 9), B: 80, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func assertJPEGSidecar(t *testing.T, f *fixture, res Result, w, h int) {
	t.Helper()
	got, err := os.ReadFile(f.thumbAbs)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(got, []byte{0xFF, 0xD8, 0xFF}) {
		t.Fatalf("sidecar starts with % x, want FF D8 FF", got[:4])
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(got))
	if err != nil || format != "jpeg" || cfg.Width != w || cfg.Height != h {
		t.Fatalf("sidecar decodes as %s %dx%d (err %v), want jpeg %dx%d", format, cfg.Width, cfg.Height, err, w, h)
	}
	if res.Width != w || res.Height != h || res.Size != int64(len(got)) {
		t.Errorf("result = %+v, want %dx%d and size %d (the converted file)", res, w, h, len(got))
	}
	it := f.item()
	if it.ThumbnailWidth == nil || *it.ThumbnailWidth != w || *it.ThumbnailHeight != h {
		t.Errorf("row dimensions = %v x %v, want %dx%d", it.ThumbnailWidth, it.ThumbnailHeight, w, h)
	}
	if hasTemp(files(t, f.mediaRoot)) {
		t.Error("temp file left behind")
	}
}

func TestReplaceConvertsPNGToJPEG(t *testing.T) {
	useRealConversion(t)
	f := newFixture(t, false, true)
	res, err := Replace(context.Background(), f.params(pngBytes(t, 24, color.RGBA{G: 200, A: 255})))
	if err != nil {
		t.Fatal(err)
	}
	assertJPEGSidecar(t, f, res, 24, 24)
}

func TestReplaceConvertsPNGWithAlpha(t *testing.T) {
	useRealConversion(t)
	f := newFixture(t, false, false)
	img := image.NewNRGBA(image.Rect(0, 0, 10, 6))
	for y := 0; y < 6; y++ {
		for x := 0; x < 10; x++ {
			a := uint8(255)
			if x < 5 {
				a = 0
			}
			img.SetNRGBA(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: a})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	res, err := Replace(context.Background(), f.params(buf.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	assertJPEGSidecar(t, f, res, 10, 6)
}

func TestReplaceWritesAJPEGByteForByte(t *testing.T) {
	calls := 0
	failConversion(t, &calls)
	f := newFixture(t, false, true)
	data := jpegData(t, 12)
	res, err := Replace(context.Background(), f.params(data))
	if err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Error("a JPEG must not be converted")
	}
	got, _ := os.ReadFile(f.thumbAbs)
	if !bytes.Equal(got, data) || res.Size != int64(len(data)) {
		t.Error("JPEG was not written byte for byte")
	}
}

func TestReplaceConversionFailureFallsBackToTheOriginalBytes(t *testing.T) {
	calls := 0
	failConversion(t, &calls)
	f := newFixture(t, false, true)
	data := pngBytes(t, 8, color.RGBA{B: 200, A: 255})
	res, err := Replace(context.Background(), f.params(data))
	if err != nil {
		t.Fatalf("a conversion failure must not fail the write: %v", err)
	}
	if calls != 1 {
		t.Errorf("conversion calls = %d, want 1", calls)
	}
	got, _ := os.ReadFile(f.thumbAbs)
	if !bytes.Equal(got, data) || res.Width != 8 || res.Size != int64(len(data)) {
		t.Errorf("fallback must store the original bytes (result %+v)", res)
	}
	if w := f.item().ThumbnailWidth; w == nil || *w != 8 {
		t.Errorf("row width = %v, want 8", w)
	}
}

func TestReplaceUndecodableDataIsRefusedBeforeAnyConversion(t *testing.T) {
	calls := 0
	failConversion(t, &calls)
	f := newFixture(t, false, true)
	before := f.snapshot()
	// WebP magic: ffmpeg could decode a real one, the Go decoder cannot — still refused.
	webp := append([]byte("RIFF\x24\x00\x00\x00WEBPVP8 "), make([]byte, 40)...)
	for _, data := range [][]byte{[]byte("not an image"), nil, webp} {
		if _, err := Replace(context.Background(), f.params(data)); !errors.Is(err, ErrNotAnImage) {
			t.Fatalf("err = %v, want ErrNotAnImage", err)
		}
	}
	if calls != 0 {
		t.Error("conversion must not run for refused data")
	}
	f.assertUnchanged(before)
}

func TestReplaceNeverConvertsImageItemsOrTheMediaFile(t *testing.T) {
	calls := 0
	failConversion(t, &calls)
	data := pngBytes(t, 8, color.RGBA{R: 9, A: 255})

	f := newFixture(t, false, true)
	if _, err := f.db.Exec(`UPDATE library SET media_type = 'image' WHERE id = ?`, f.id); err != nil {
		t.Fatal(err)
	}
	if _, err := Replace(context.Background(), f.params(data)); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(f.thumbAbs); !bytes.Equal(got, data) {
		t.Error("an image item's file must be written unchanged")
	}

	// A video-typed item whose sidecar path is its media file.
	g := newFixture(t, false, false)
	p := g.params(data)
	p.MediaRoot = g.mediaRoot
	p.ThumbAbs = g.mediaRoot + "/show/Video.mp4.jpg"
	if _, err := g.db.Exec(`UPDATE library SET path = ? WHERE id = ?`, "show/Video.mp4.jpg", g.id); err != nil {
		t.Fatal(err)
	}
	if _, err := Replace(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Errorf("conversion ran %d times, want 0", calls)
	}
}

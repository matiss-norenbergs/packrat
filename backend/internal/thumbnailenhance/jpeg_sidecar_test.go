package thumbnailenhance

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
	"path/filepath"
	"testing"

	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/thumbwrite"
)

// useRealJPEGConversion points the conversion seam at the machine's real ffmpeg (the fixture's
// own ffmpeg is a fake that only knows how to write .webp tiers; thumbwrite.Replace converts through the seam). Skips without ffmpeg.
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

func jpegBytes(t *testing.T, size int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 20), G: uint8(y * 20), B: 90, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// newJPEGFixture is newFixture with a real JPEG sidecar named Video.jpg (as a download produces),
// so the item is a normal video with a .jpg sidecar.
func newJPEGFixture(t *testing.T) *fixture {
	t.Helper()
	f := newFixture(t, false)
	f.original = jpegBytes(t, 4)
	newAbs := filepath.Join(filepath.Dir(f.thumbAbs), "Video.jpg")
	if err := os.Remove(f.thumbAbs); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newAbs, f.original, 0o640); err != nil {
		t.Fatal(err)
	}
	f.thumbAbs = newAbs
	if _, err := f.conn.Exec(`UPDATE library SET thumbnail = ? WHERE id = ?`, "show/Video.jpg", f.itemID); err != nil {
		t.Fatal(err)
	}
	return f
}

func rowAndFileDims(t *testing.T, f *fixture, wantW, wantH int) {
	t.Helper()
	fh, err := os.Open(f.thumbAbs)
	if err != nil {
		t.Fatal(err)
	}
	defer fh.Close()
	cfg, format, err := image.DecodeConfig(fh)
	if err != nil || format != "jpeg" || cfg.Width != wantW || cfg.Height != wantH {
		t.Fatalf("sidecar decodes as %s %dx%d (err %v), want jpeg %dx%d", format, cfg.Width, cfg.Height, err, wantW, wantH)
	}
	it := f.item()
	if it.ThumbnailWidth == nil || *it.ThumbnailWidth != wantW || *it.ThumbnailHeight != wantH {
		t.Errorf("row dimensions = %v x %v, want %dx%d", it.ThumbnailWidth, it.ThumbnailHeight, wantW, wantH)
	}
}

func TestEnhancedPNGIsStoredAsJPEGEndToEnd(t *testing.T) {
	useRealJPEGConversion(t)
	f := newJPEGFixture(t)
	enhancedPNG := pngBytes(t, 16, color.RGBA{G: 200, A: 255})

	if err := f.run(f.upscaler(enhancedPNG), false); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(f.thumbAbs)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(got, []byte{0xFF, 0xD8, 0xFF}) {
		t.Fatalf("sidecar starts with % x, want the JPEG magic FF D8 FF", got[:4])
	}
	rowAndFileDims(t, f, 16, 16)

	// File size in the history row describes the converted file, not the PNG.
	var size int64
	if err := f.conn.QueryRow(`SELECT enhanced_size_bytes FROM thumbnail_enhancement_history ORDER BY id DESC LIMIT 1`).Scan(&size); err != nil {
		t.Fatal(err)
	}
	if size != int64(len(got)) {
		t.Errorf("recorded size = %d, want the converted file's %d", size, len(got))
	}

	// The backup is the previous sidecar, byte for byte.
	rel, err := f.deps.OriginalsRepo.Get(context.Background(), f.itemID)
	if err != nil {
		t.Fatal(err)
	}
	backup, err := os.ReadFile(filepath.Join(f.deps.ImagesRoot, filepath.FromSlash(rel)))
	if err != nil || !bytes.Equal(backup, f.original) {
		t.Fatalf("backup does not hold the previous sidecar (err %v)", err)
	}

	if hasTemp(files(t, f.deps.MediaRoot)) {
		t.Error("temp file left behind")
	}

	// Revert restores the previous sidecar and its dimensions.
	if err := RevertOriginal(context.Background(), f.deps, f.itemID); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(f.thumbAbs)
	if !bytes.Equal(after, f.original) {
		t.Error("revert did not restore the previous sidecar")
	}
	rowAndFileDims(t, f, 4, 4)
	if f.backupRows() != 0 || hasTemp(files(t, f.deps.MediaRoot)) {
		t.Error("backup row or temp file left after revert")
	}
}

func TestEnhancedAutoApproveStoresJPEGWithoutBackup(t *testing.T) {
	useRealJPEGConversion(t)
	f := newJPEGFixture(t)
	if err := f.run(f.upscaler(pngBytes(t, 12, color.RGBA{B: 200, A: 255})), true); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(f.thumbAbs)
	if !imageproc.IsJPEG(got) {
		t.Fatal("sidecar is not a JPEG")
	}
	if f.backupRows() != 0 {
		t.Error("auto-approve must not create a backup")
	}
	rowAndFileDims(t, f, 12, 12)
}

func TestEnhancedPNGWithAlphaConverts(t *testing.T) {
	useRealJPEGConversion(t)
	f := newJPEGFixture(t)
	img := image.NewNRGBA(image.Rect(0, 0, 10, 10))
	for y := 0; y < 10; y++ {
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
	if err := f.run(f.upscaler(buf.Bytes()), false); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(f.thumbAbs)
	if !imageproc.IsJPEG(got) {
		t.Fatal("alpha PNG was not converted")
	}
	rowAndFileDims(t, f, 10, 10)
}

func TestConversionFailureFallsBackToTheUpscalersBytes(t *testing.T) {
	old := thumbwrite.ConvertToJPEG
	thumbwrite.ConvertToJPEG = func(context.Context, string, []byte) ([]byte, error) { return nil, errors.New("ffmpeg exploded") }
	defer func() { thumbwrite.ConvertToJPEG = old }()

	f := newJPEGFixture(t)
	enhancedPNG := pngBytes(t, 8, color.RGBA{G: 200, A: 255})
	if err := f.run(f.upscaler(enhancedPNG), false); err != nil {
		t.Fatalf("a conversion failure must not fail the enhancement: %v", err)
	}
	got, _ := os.ReadFile(f.thumbAbs)
	if !bytes.Equal(got, enhancedPNG) {
		t.Error("fallback must write the upscaler's original bytes")
	}
	if f.backupRows() != 1 || len(f.historyStatuses()) != 1 || f.historyStatuses()[0] != "success" {
		t.Errorf("history = %v, backups = %d", f.historyStatuses(), f.backupRows())
	}
	if it := f.item(); *it.ThumbnailWidth != 8 {
		t.Errorf("width = %d, want 8", *it.ThumbnailWidth)
	}
}

func TestAlreadyJPEGResultIsWrittenUnchanged(t *testing.T) {
	old := thumbwrite.ConvertToJPEG
	thumbwrite.ConvertToJPEG = func(context.Context, string, []byte) ([]byte, error) {
		t.Error("an already-JPEG result must not be re-encoded")
		return nil, errors.New("unexpected")
	}
	defer func() { thumbwrite.ConvertToJPEG = old }()

	f := newJPEGFixture(t)
	enhanced := jpegBytes(t, 9)
	if err := f.run(f.upscaler(enhanced), false); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(f.thumbAbs)
	if !bytes.Equal(got, enhanced) {
		t.Error("JPEG result was not written byte for byte")
	}
}

// An item enhanced several times before sidecars were converted can have a PNG under the .jpg name
// as its backup. Revert writes through thumbwrite.Replace, so it now restores a JPEG with the same
// pixels (same dimensions) and must not fail.
func TestRevertOfAPNGBackupRestoresAJPEG(t *testing.T) {
	useRealJPEGConversion(t)
	f := newJPEGFixture(t)
	if err := f.run(f.upscaler(jpegBytes(t, 9)), false); err != nil {
		t.Fatal(err)
	}
	rel, err := f.deps.OriginalsRepo.Get(context.Background(), f.itemID)
	if err != nil {
		t.Fatal(err)
	}
	backupAbs := filepath.Join(f.deps.ImagesRoot, filepath.FromSlash(rel))
	if err := os.WriteFile(backupAbs, pngBytes(t, 6, color.RGBA{R: 200, A: 255}), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := RevertOriginal(context.Background(), f.deps, f.itemID); err != nil {
		t.Fatalf("revert of a PNG backup must not fail: %v", err)
	}
	got, _ := os.ReadFile(f.thumbAbs)
	if !imageproc.IsJPEG(got) {
		t.Fatal("reverted sidecar is not a JPEG")
	}
	rowAndFileDims(t, f, 6, 6)
}

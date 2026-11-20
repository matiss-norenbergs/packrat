package imageproc

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func ffmpegOrSkip(tb testing.TB) string {
	tb.Helper()
	p, err := exec.LookPath("ffmpeg")
	if err != nil {
		tb.Skip("ffmpeg not on PATH")
	}
	return p
}

func encodePNG(tb testing.TB, img image.Image) []byte {
	tb.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		tb.Fatal(err)
	}
	return buf.Bytes()
}

func encodeJPEG(tb testing.TB, img image.Image) []byte {
	tb.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		tb.Fatal(err)
	}
	return buf.Bytes()
}

// photoLike is noise over diagonal gradients: incompressible enough that PNG
// is large and JPEG is meaningfully smaller, like a real photo.
func photoLike(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	rng := rand.New(rand.NewSource(1))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			n := rng.Intn(24)
			img.SetRGBA(x, y, color.RGBA{
				R: uint8((x*255/w + n) % 256),
				G: uint8((y*255/h + n) % 256),
				B: uint8(((x+y)*255/(w+h) + n) % 256),
				A: 255,
			})
		}
	}
	return img
}

func TestNeedsJPEGConversion(t *testing.T) {
	small := photoLike(8, 8)
	var webpHead = append([]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), make([]byte, 16)...)
	cases := []struct {
		name string
		data []byte
		want bool
	}{
		{"jpeg stays", encodeJPEG(t, small), false},
		{"png converts", encodePNG(t, small), true},
		{"webp converts", webpHead, true},
		{"gif converts", []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;"), true},
		{"junk is not convertible", []byte("this is not an image at all"), false},
		{"html is not convertible", []byte("<html><body>nope</body></html>"), false},
		{"empty", nil, false},
	}
	for _, c := range cases {
		if got := NeedsJPEGConversion(c.data); got != c.want {
			t.Errorf("%s: NeedsJPEGConversion = %v, want %v", c.name, got, c.want)
		}
	}
}

func decodeDims(t *testing.T, b []byte) (int, int) {
	t.Helper()
	cfg, format, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("result is not decodable: %v", err)
	}
	if format != "jpeg" {
		t.Fatalf("format = %s, want jpeg", format)
	}
	return cfg.Width, cfg.Height
}

func TestBytesToJPEGInputs(t *testing.T) {
	ff := ffmpegOrSkip(t)

	rgba := image.NewNRGBA(image.Rect(0, 0, 40, 30))
	for y := 0; y < 30; y++ {
		for x := 0; x < 40; x++ {
			if x < 20 {
				rgba.SetNRGBA(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 0}) // transparent (white RGB underneath)
			} else {
				rgba.SetNRGBA(x, y, color.NRGBA{R: 200, G: 30, B: 30, A: 255})
			}
		}
	}
	gray16 := image.NewGray16(image.Rect(0, 0, 33, 17)) // odd size, 16-bit
	for y := 0; y < 17; y++ {
		for x := 0; x < 33; x++ {
			gray16.SetGray16(x, y, color.Gray16{Y: uint16(x * 2000)})
		}
	}
	rgba64 := image.NewRGBA64(image.Rect(0, 0, 64, 48))
	for y := 0; y < 48; y++ {
		for x := 0; x < 64; x++ {
			rgba64.SetRGBA64(x, y, color.RGBA64{R: uint16(x * 1000), G: uint16(y * 1300), B: 40000, A: 0xFFFF})
		}
	}

	for _, c := range []struct {
		name string
		img  image.Image
		w, h int
	}{
		{"rgba with transparency", rgba, 40, 30},
		{"16-bit grayscale odd size", gray16, 33, 17},
		{"16-bit rgba", rgba64, 64, 48},
		{"plain rgb", photoLike(64, 48), 64, 48},
	} {
		t.Run(c.name, func(t *testing.T) {
			out, err := BytesToJPEG(context.Background(), ff, encodePNG(t, c.img))
			if err != nil {
				t.Fatal(err)
			}
			if !IsJPEG(out) {
				t.Fatal("no JPEG magic bytes")
			}
			if w, h := decodeDims(t, out); w != c.w || h != c.h {
				t.Fatalf("dims %dx%d, want %dx%d", w, h, c.w, c.h)
			}
		})
	}

	t.Run("alpha is flattened onto black", func(t *testing.T) {
		out, err := BytesToJPEG(context.Background(), ff, encodePNG(t, rgba))
		if err != nil {
			t.Fatal(err)
		}
		img, err := jpeg.Decode(bytes.NewReader(out))
		if err != nil {
			t.Fatal(err)
		}
		r, g, b, _ := img.At(5, 15).RGBA() // inside the transparent half
		if r>>8 > 20 || g>>8 > 20 || b>>8 > 20 {
			t.Errorf("transparent pixel = %d,%d,%d, want near black", r>>8, g>>8, b>>8)
		}
		r, _, _, _ = img.At(30, 15).RGBA() // inside the opaque half
		if r>>8 < 170 {
			t.Errorf("opaque pixel red = %d, want about 200", r>>8)
		}
	})

	t.Run("webp input", func(t *testing.T) {
		dir := t.TempDir()
		src := filepath.Join(dir, "in.png")
		dst := filepath.Join(dir, "in.webp")
		if err := os.WriteFile(src, encodePNG(t, photoLike(50, 40)), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := exec.Command(ff, "-v", "error", "-y", "-i", src, "-c:v", "libwebp", dst).Run(); err != nil {
			t.Skipf("this ffmpeg cannot write webp: %v", err)
		}
		data, _ := os.ReadFile(dst)
		if !NeedsJPEGConversion(data) {
			t.Fatal("webp not detected")
		}
		out, err := BytesToJPEG(context.Background(), ff, data)
		if err != nil {
			t.Fatal(err)
		}
		if w, h := decodeDims(t, out); w != 50 || h != 40 {
			t.Fatalf("dims %dx%d", w, h)
		}
	})

	t.Run("junk fails", func(t *testing.T) {
		if _, err := BytesToJPEG(context.Background(), ff, []byte("not an image")); err == nil {
			t.Fatal("want an error")
		}
	})
	t.Run("missing ffmpeg fails", func(t *testing.T) {
		if _, err := BytesToJPEG(context.Background(), filepath.Join(t.TempDir(), "nope"), encodePNG(t, photoLike(4, 4))); err == nil {
			t.Fatal("want an error")
		}
	})
}

// TestBytesToJPEGMeasure logs size and time for a photo-like 1920x1080 frame
// (run with -v).
func TestBytesToJPEGMeasure(t *testing.T) {
	ff := ffmpegOrSkip(t)
	data := encodePNG(t, photoLike(1920, 1080))
	start := time.Now()
	out, err := BytesToJPEG(context.Background(), ff, data)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("1920x1080 photo-like: PNG %d bytes -> JPEG %d bytes (%.1f%%) in %v", len(data), len(out), 100*float64(len(out))/float64(len(data)), time.Since(start))
}

package imageproc

import (
	"bytes"
	"context"
	"fmt"
	"image"
	_ "image/jpeg" // registers the JPEG decoder for image.DecodeConfig
	_ "image/png"  // registers the PNG decoder for image.DecodeConfig
	"net/http"
	"os/exec"
	"strings"
)

// jpegQuality is ffmpeg's mjpeg -q:v for BytesToJPEG: the same value as
// ConvertImage's "jpg" case and ExtractFrame's JPEG frames (downloader/ytdlp.go),
// so every JPEG the app encodes has the same quality (2 is near-lossless: the
// scale runs 2 best to 31 worst).
const jpegQuality = "2"

// flattenFilter turns any input (8/16-bit, with or without alpha) into opaque
// 8-bit full-range YUV 4:2:0 for the mjpeg encoder. Transparency is flattened
// deliberately onto BLACK: a copy of the frame is filled solid black and the
// original is overlaid on it. Dimensions are never changed.
const flattenFilter = "format=rgba,split[fg][bgsrc];[bgsrc]drawbox=c=black:t=fill:w=iw:h=ih[bg];[bg][fg]overlay=format=auto,format=yuvj420p"

// NeedsJPEGConversion reports whether data is a raster image in a format other
// than JPEG that BytesToJPEG should convert: PNG, WebP, GIF or BMP, detected
// from the bytes themselves (never a header or extension). JPEG data and
// anything unrecognised (junk, HTML, an empty body) report false.
func NeedsJPEGConversion(data []byte) bool {
	switch http.DetectContentType(data) {
	case "image/png", "image/webp", "image/gif", "image/bmp":
		return true
	}
	return false
}

// IsJPEG reports whether data starts with the JPEG magic bytes (FF D8 FF).
func IsJPEG(data []byte) bool {
	return len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF
}

// BytesToJPEG converts one image (PNG, WebP, ...) to a full-resolution JPEG
// through ffmpeg, piping the bytes in and out so no temp file is involved.
// Only the first frame of an animated input is kept. The result is verified:
// it must carry the JPEG magic bytes and, when the input's dimensions can be
// read, have exactly the same dimensions; otherwise an error is returned and
// the caller keeps the original bytes.
func BytesToJPEG(ctx context.Context, ffmpegPath string, data []byte) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, generateTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, ffmpegPath, "-v", "error", "-f", "image2pipe", "-i", "pipe:0",
		"-an", "-frames:v", "1", "-filter_complex", flattenFilter,
		"-c:v", "mjpeg", "-q:v", jpegQuality, "-f", "image2pipe", "pipe:1")
	cmd.Stdin = bytes.NewReader(data)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffmpeg jpeg convert failed: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	out := stdout.Bytes()
	if !IsJPEG(out) {
		return nil, fmt.Errorf("ffmpeg jpeg convert produced %d bytes that are not a JPEG", len(out))
	}
	outCfg, _, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil {
		return nil, fmt.Errorf("converted JPEG is not decodable: %w", err)
	}
	if inCfg, _, err := image.DecodeConfig(bytes.NewReader(data)); err == nil &&
		(inCfg.Width != outCfg.Width || inCfg.Height != outCfg.Height) {
		return nil, fmt.Errorf("converted JPEG is %dx%d, input is %dx%d", outCfg.Width, outCfg.Height, inCfg.Width, inCfg.Height)
	}
	return out, nil
}

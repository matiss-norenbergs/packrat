package downloader

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
)

// DecodeImageToJPEG decodes any image file ffmpeg understands (AVIF, WebP,
// PNG, JPEG, ...) into JPEG bytes. Used for reference images pulled
// straight from a source URL via FetchThumbnailRaw, where the format is
// whatever the platform happens to serve — a single, explicit decode step
// so a real failure (e.g. no AVIF decoder available) surfaces as a real
// error instead of being swallowed by a postprocessor.
func DecodeImageToJPEG(ctx context.Context, ffmpegPath, imagePath string) ([]byte, error) {
	args := []string{
		"-y", "-i", imagePath,
		"-frames:v", "1", "-q:v", "2",
		"-f", "image2pipe", "-vcodec", "mjpeg", "-",
	}
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg couldn't decode %s: %w: %s", imagePath, err, stderr.String())
	}
	return out, nil
}

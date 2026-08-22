package imageproc

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// ConvertImage re-encodes srcAbs to format ("jpg"|"png"|"webp") at dstAbs,
// full resolution — contrast with GenerateWebP, which is for the resized
// small/medium/etc. derivative tiers. Used by the "image" download type's
// configurable convert-on-download step (see models.SettingImageConvertFormat
// in the api package); "original" is handled by the caller simply not
// calling this at all, so ConvertImage itself never needs an "original" case.
func ConvertImage(ctx context.Context, ffmpegPath, srcAbs, dstAbs, format string) error {
	ctx, cancel := context.WithTimeout(ctx, generateTimeout)
	defer cancel()

	var codecArgs []string
	switch format {
	case "jpg":
		codecArgs = []string{"-c:v", "mjpeg", "-q:v", "2"} // matches ExtractFrame's existing JPEG quality convention (downloader/ytdlp.go)
	case "png":
		codecArgs = []string{"-c:v", "png"} // lossless, no quality flag needed
	case "webp":
		codecArgs = []string{"-c:v", "libwebp", "-q:v", "80"} // matches GenerateWebP's existing quality
	default:
		return fmt.Errorf("imageproc: unsupported convert format %q", format)
	}

	args := append([]string{"-y", "-i", srcAbs}, codecArgs...)
	args = append(args, dstAbs)
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg image convert failed: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

package framematch

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
)

// ResolveReferenceImage decodes the reference image to compare item's video
// against, for either mode — shared by the single-item ad-hoc match handler
// (api.StartFrameMatch) and the bulk queue runner (RunQueue), so both
// resolve "url" vs "current" identically.
//
// Mode "url" deliberately does not reuse YtDlpService.FetchThumbnail: that
// helper runs yt-dlp's --convert-thumbnails postprocessor, the exact
// pipeline already known to fail silently-ish on formats like AVIF (see
// queue/manager.go's exit-code leniency comment). FetchThumbnailRaw fetches
// the source format untouched, and DecodeImageToJPEG converts it as an
// explicit step this function controls — a real decode failure comes back
// as a real error instead of a missing file.
func ResolveReferenceImage(ctx context.Context, ytdlp *downloader.YtDlpService, mediaRoot string, item models.LibraryItem, mode string) ([]byte, error) {
	switch mode {
	case "current":
		if item.Thumbnail == nil {
			return nil, fmt.Errorf("item has no thumbnail to compare against")
		}
		// Despite the .jpg extension this file isn't reliably real JPEG
		// bytes — AI Enhancement (internal/thumbnailenhance) writes its
		// upscaler output to this same path without re-encoding, and that
		// output can be PNG. Route through the same ffmpeg decode used for
		// mode "url" instead of assuming the format.
		thumbAbs := filepath.Join(mediaRoot, filepath.FromSlash(*item.Thumbnail))
		data, err := downloader.DecodeImageToJPEG(ctx, ytdlp.FFmpegPath, thumbAbs)
		if err != nil {
			return nil, fmt.Errorf("reading current thumbnail: %w", err)
		}
		return data, nil

	case "url":
		if item.OriginalURL == nil {
			return nil, fmt.Errorf("no source URL set for this item")
		}
		rawPath, err := ytdlp.FetchThumbnailRaw(ctx, *item.OriginalURL, os.TempDir(), "framematch-ref-"+uuid.NewString())
		if err != nil {
			return nil, fmt.Errorf("fetching source thumbnail: %w", err)
		}
		defer os.Remove(rawPath)
		data, err := downloader.DecodeImageToJPEG(ctx, ytdlp.FFmpegPath, rawPath)
		if err != nil {
			return nil, fmt.Errorf("decoding source thumbnail: %w", err)
		}
		return data, nil

	default:
		return nil, fmt.Errorf("invalid mode %q", mode)
	}
}

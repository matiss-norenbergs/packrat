// Package imageproc generates the small/medium/original WebP derivatives
// used to keep grid/list/strip views from downloading full-resolution
// source images. ffmpeg is already a hard runtime dependency of this app
// (frame extraction, downloads) and is the only image-manipulation path
// that exists in this codebase, so derivative generation shells out to it
// rather than adding a new (cgo-dependent, for WebP encoding) Go library.
package imageproc

import (
	"bytes"
	"context"
	"fmt"
	"image"
	_ "image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Target widths for each derivative tier. Height is always derived to
// preserve aspect ratio. Source images narrower than the target width are
// never upscaled (see GenerateWebP's scale filter).
const (
	ThumbnailSmallWidth  = 320
	ThumbnailMediumWidth = 800
	CoverOriginalWidth   = 1920
	ArtistImageWidth     = 400
)

const generateTimeout = 30 * time.Second

// GenerateWebP resizes (never upscales) and re-encodes the image at srcAbs
// to a WebP file at dstAbs, capping width at maxWidth while preserving
// aspect ratio.
func GenerateWebP(ctx context.Context, ffmpegPath, srcAbs, dstAbs string, maxWidth int) error {
	ctx, cancel := context.WithTimeout(ctx, generateTimeout)
	defer cancel()

	// The comma inside min(iw,maxWidth) must be escaped for ffmpeg's own
	// filtergraph parser (which otherwise reads it as a filter separator) —
	// this isn't shell quoting, there's no shell involved via exec.Command.
	scaleFilter := fmt.Sprintf(`scale='min(iw\,%d)':-2`, maxWidth)

	cmd := exec.CommandContext(ctx, ffmpegPath, "-y", "-i", srcAbs, "-vf", scaleFilter, "-c:v", "libwebp", "-q:v", "80", dstAbs)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg webp encode failed: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

// Tier names one derivative to generate — Name is the disk subfolder
// ("small"/"medium"/"original"/"image"), MaxWidth the cap passed to
// GenerateWebP.
type Tier struct {
	Name     string
	MaxWidth int
}

// GenerateTiers writes srcBytes to a temp file, then generates one WebP
// derivative per requested tier — see GenerateTiersFromPath for the layout
// convention and cache-busting rationale.
func GenerateTiers(ctx context.Context, ffmpegPath, imagesRoot, kind string, entityID int64, srcBytes []byte, srcNameHint string, tiers []Tier) ([]string, error) {
	tmp, err := os.CreateTemp("", "packrat-img-*"+extFor(srcNameHint))
	if err != nil {
		return nil, fmt.Errorf("creating temp source image: %w", err)
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(srcBytes); err != nil {
		tmp.Close()
		return nil, fmt.Errorf("writing temp source image: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return nil, fmt.Errorf("writing temp source image: %w", err)
	}

	return GenerateTiersFromPath(ctx, ffmpegPath, imagesRoot, kind, entityID, tmp.Name(), tiers)
}

// GenerateTiersFromPath generates one WebP derivative per requested tier
// under <imagesRoot>/<kind>/<entityID>/<tier.Name>/<uid>.webp — the same uid
// across every tier from one call so they're visibly tied to one generation
// event, and fresh every call so replacing an image always changes the URL
// (cache-busting — a fixed filename would let the browser keep showing
// stale bytes after a same-path replacement, since the <img src> string
// would never change). Returns the relative paths (under imagesRoot) in the
// same order as tiers. Used when the source image is already a file on disk
// (e.g. a library item's sidecar thumbnail); GenerateTiers is the
// byte-slice-source sibling for upload/copy flows.
func GenerateTiersFromPath(ctx context.Context, ffmpegPath, imagesRoot, kind string, entityID int64, srcAbs string, tiers []Tier) ([]string, error) {
	uid := uuid.NewString()
	paths := make([]string, len(tiers))
	for i, tier := range tiers {
		destDir := filepath.Join(imagesRoot, kind, strconv.FormatInt(entityID, 10), tier.Name)
		if err := os.MkdirAll(destDir, 0o755); err != nil {
			return nil, fmt.Errorf("creating %s tier dir: %w", tier.Name, err)
		}
		destAbs := filepath.Join(destDir, uid+".webp")
		if err := GenerateWebP(ctx, ffmpegPath, srcAbs, destAbs, tier.MaxWidth); err != nil {
			return nil, fmt.Errorf("generating %s tier: %w", tier.Name, err)
		}
		rel, err := filepath.Rel(imagesRoot, destAbs)
		if err != nil {
			rel = destAbs
		}
		paths[i] = filepath.ToSlash(rel)
	}
	return paths, nil
}

// ProbeDimensions reads an image file's pixel width/height from its header
// only (image.DecodeConfig — no full pixel decode), so it's cheap enough to
// call on every original-thumbnail write. The source is always a JPEG by
// convention (yt-dlp's --convert-thumbnails jpg, frame-grabs, manual sets),
// hence the blank image/jpeg import above rather than pulling in WebP/AVIF
// decode support this call site never needs.
func ProbeDimensions(srcAbs string) (width, height int, err error) {
	f, err := os.Open(srcAbs)
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()
	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return 0, 0, fmt.Errorf("decoding image header: %w", err)
	}
	return cfg.Width, cfg.Height, nil
}

// extFor returns a safe, lowercased image extension derived from name,
// defaulting to .jpg when name has none or an unrecognized one — every
// GenerateTiers input is always a real image, so an unknown/missing
// extension is a naming detail for the temp file, not something worth
// failing over.
func extFor(name string) string {
	switch ext := strings.ToLower(filepath.Ext(name)); ext {
	case ".jpg", ".jpeg", ".png", ".webp":
		return ext
	default:
		return ".jpg"
	}
}

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
	return GenerateWebPBox(ctx, ffmpegPath, srcAbs, dstAbs, maxWidth, 0)
}

// scaleFilterFor builds the ffmpeg scale filter shared by every WebP
// generation path: width-capped (maxHeight == 0) or fit-inside-a-box, never
// upscaling. The comma inside min(iw,maxWidth) must be escaped for ffmpeg's
// own filtergraph parser (which otherwise reads it as a filter separator) -
// this isn't shell quoting, there's no shell involved via exec.Command.
func scaleFilterFor(maxWidth, maxHeight int) string {
	if maxHeight > 0 {
		return fmt.Sprintf(`scale='min(iw\,%d)':'min(ih\,%d)':force_original_aspect_ratio=decrease`, maxWidth, maxHeight)
	}
	return fmt.Sprintf(`scale='min(iw\,%d)':-2`, maxWidth)
}

// GenerateWebPBox is GenerateWebP with an optional height cap: maxHeight > 0
// scales the image to fit inside a maxWidth x maxHeight box (aspect ratio
// preserved, never upscaled, never cropped/padded). maxHeight == 0 is exactly
// the width-only behaviour of GenerateWebP.
func GenerateWebPBox(ctx context.Context, ffmpegPath, srcAbs, dstAbs string, maxWidth, maxHeight int) error {
	ctx, cancel := context.WithTimeout(ctx, generateTimeout)
	defer cancel()

	scaleFilter := scaleFilterFor(maxWidth, maxHeight)

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
// would never change). All tiers come from a single ffmpeg invocation (the
// source is decoded once). Returns the relative paths (under imagesRoot) in the
// same order as tiers. Used when the source image is already a file on disk
// (e.g. a library item's sidecar thumbnail); GenerateTiers is the
// byte-slice-source sibling for upload/copy flows.
func GenerateTiersFromPath(ctx context.Context, ffmpegPath, imagesRoot, kind string, entityID int64, srcAbs string, tiers []Tier) ([]string, error) {
	uid := uuid.NewString()
	paths := make([]string, len(tiers))
	destAbs := make([]string, len(tiers))
	for i, tier := range tiers {
		destDir := filepath.Join(imagesRoot, kind, strconv.FormatInt(entityID, 10), tier.Name)
		if err := os.MkdirAll(destDir, 0o755); err != nil {
			return nil, fmt.Errorf("creating %s tier dir: %w", tier.Name, err)
		}
		destAbs[i] = filepath.Join(destDir, uid+".webp")
		rel, err := filepath.Rel(imagesRoot, destAbs[i])
		if err != nil {
			rel = destAbs[i]
		}
		paths[i] = filepath.ToSlash(rel)
	}
	if len(tiers) == 0 {
		return paths, nil
	}

	if err := generateWebPTiers(ctx, ffmpegPath, srcAbs, destAbs, tiers); err != nil {
		// Never leave a half-generated set behind: a later retry mints a new
		// uid, so these files would otherwise be orphaned forever.
		for _, p := range destAbs {
			os.Remove(p)
		}
		return nil, err
	}
	return paths, nil
}

// generateWebPTiers decodes srcAbs once and writes one WebP per tier with a
// single ffmpeg invocation: the decoded frame is split into one branch per
// tier, each branch gets the same scale filter GenerateWebP would apply for
// that tier's width, and each branch is mapped to its own output. Output is
// identical to running GenerateWebP once per tier. destAbs[i] receives
// tiers[i].
func generateWebPTiers(ctx context.Context, ffmpegPath, srcAbs string, destAbs []string, tiers []Tier) error {
	ctx, cancel := context.WithTimeout(ctx, generateTimeout)
	defer cancel()

	var graph strings.Builder
	n := len(tiers)
	if n > 1 {
		graph.WriteString("[0:v]split=" + strconv.Itoa(n))
		for i := range tiers {
			fmt.Fprintf(&graph, "[s%d]", i)
		}
		graph.WriteString(";")
	}
	for i, tier := range tiers {
		in := "[0:v]"
		if n > 1 {
			in = fmt.Sprintf("[s%d]", i)
		}
		if i > 0 {
			graph.WriteString(";")
		}
		fmt.Fprintf(&graph, "%s%s[o%d]", in, scaleFilterFor(tier.MaxWidth, 0), i)
	}

	args := []string{"-y", "-i", srcAbs, "-filter_complex", graph.String()}
	for i := range tiers {
		args = append(args, "-map", fmt.Sprintf("[o%d]", i), "-c:v", "libwebp", "-q:v", "80", destAbs[i])
	}

	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg webp tier encode failed: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
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

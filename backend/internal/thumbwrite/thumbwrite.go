// Package thumbwrite replaces an item's sidecar thumbnail without ever leaving
// the item half-changed. It is the one place that writes the sidecar: AI
// enhancement and revert (thumbnailenhance) and every thumbnail action of the
// API (set, quick grab, gallery apply, frame-match accept, redownload) call
// Replace, so neither package depends on the other's internals.
package thumbwrite

import (
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"os"
	"path/filepath"

	"packrat/backend/internal/fsutil"
	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/repository"
)

// Tiers is the derivative set generated for every library thumbnail.
var Tiers = []imageproc.Tier{
	{Name: "small", MaxWidth: imageproc.ThumbnailSmallWidth},
	{Name: "medium", MaxWidth: imageproc.ThumbnailMediumWidth},
}

// ErrNotAnImage is returned (wrapped) when the data is not a decodable image.
// Nothing has been changed when it is returned.
var ErrNotAnImage = errors.New("the data is not a decodable image")

// Seams for the failure-injection tests (in any package); production always
// uses the defaults.
var (
	// RenameFile moves the temp file over the sidecar.
	RenameFile = os.Rename
	// UpdateRow writes the thumbnail path, tiers and dimensions in one statement.
	UpdateRow = func(ctx context.Context, repo *repository.LibraryRepo, id int64, thumbnail, small, medium *string, w, h *int) error {
		return repo.UpdateThumbnailAndTiers(ctx, id, thumbnail, small, medium, w, h)
	}
)

// Params describes one replacement.
type Params struct {
	Repo       *repository.LibraryRepo
	FFmpegPath string
	ImagesRoot string
	ID         int64
	// ThumbAbs is the sidecar's absolute path.
	ThumbAbs string
	// ThumbRel is the sidecar's path relative to the media root, written to the
	// row's thumbnail column (also when it was NULL). Nil keeps whatever the row has.
	ThumbRel *string
	Data     []byte
}

// Result describes the thumbnail that is now in place.
type Result struct {
	Width, Height int
	Size          int64
}

// Replace puts Data in place as the item's sidecar thumbnail and regenerates
// its WebP tiers. Callers should hold the item lock for the call (the sidecar
// is a companion file of the media file) and must not hold a database
// transaction: the database step is a single statement.
//
// Order — everything that can fail happens before the sidecar is touched:
//
//	a. write Data to a temp file next to the sidecar (.packrat-thumb-*, same filesystem)
//	b. probe the temp file — data that isn't an image stops here (ErrNotAnImage)
//	c. generate the tiers from the temp file (new uuid file names, nothing overwritten)
//	d. point the row at the sidecar path, new tiers and dimensions (one statement)
//	e. rename the temp file over the sidecar (atomic); if that fails, restore the row
//	f. only then delete the old derivative files (best effort)
//
// On any error before (f) the sidecar, the old derivatives and the library row
// are as they were, and the temp file and the new tier files are removed.
func Replace(ctx context.Context, p Params) (Result, error) {
	existing, err := p.Repo.Get(ctx, p.ID)
	if err != nil {
		return Result{}, fmt.Errorf("reloading item: %w", err)
	}
	thumbnail := p.ThumbRel
	if thumbnail == nil {
		thumbnail = existing.Thumbnail
	}

	tmpAbs, err := writeSiblingTemp(p.ThumbAbs, p.Data)
	if err != nil {
		return Result{}, err
	}
	committed := false
	defer func() {
		if !committed {
			os.Remove(tmpAbs)
		}
	}()

	w, h, s, err := Probe(tmpAbs)
	if err != nil {
		return Result{}, fmt.Errorf("probing thumbnail: %w", err)
	}

	tiers, err := imageproc.GenerateTiersFromPath(ctx, p.FFmpegPath, p.ImagesRoot, "library", p.ID, tmpAbs, Tiers)
	if err != nil {
		return Result{}, fmt.Errorf("generating thumbnail derivatives: %w", err)
	}
	small, medium := tiers[0], tiers[1]
	removeNewTiers := func() {
		for _, rel := range tiers {
			if err := os.Remove(filepath.Join(p.ImagesRoot, filepath.FromSlash(rel))); err != nil && !os.IsNotExist(err) {
				log.Printf("thumbwrite: item %d: removing unused new derivative %s failed: %v", p.ID, rel, err)
			}
		}
	}

	if err := UpdateRow(ctx, p.Repo, p.ID, thumbnail, &small, &medium, &w, &h); err != nil {
		removeNewTiers()
		return Result{}, fmt.Errorf("updating thumbnail row: %w", err)
	}

	if err := RenameFile(tmpAbs, p.ThumbAbs); err != nil {
		// Put the row back before anything is deleted: the old derivatives still exist.
		if rerr := UpdateRow(context.WithoutCancel(ctx), p.Repo, p.ID, existing.Thumbnail,
			existing.ThumbnailSmallPath, existing.ThumbnailMediumPath, existing.ThumbnailWidth, existing.ThumbnailHeight); rerr != nil {
			// The row still names the new tiers, so they must stay on disk.
			log.Printf("thumbwrite: item %d: restoring the thumbnail row after a failed rename failed: %v", p.ID, rerr)
		} else {
			removeNewTiers()
		}
		return Result{}, fmt.Errorf("replacing thumbnail file: %w", err)
	}
	committed = true

	for _, old := range []*string{existing.ThumbnailSmallPath, existing.ThumbnailMediumPath} {
		if old == nil {
			continue
		}
		abs := filepath.Join(p.ImagesRoot, filepath.FromSlash(*old))
		if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
			log.Printf("thumbwrite: item %d: failed to delete old derivative %s: %v", p.ID, abs, err)
		}
	}

	return Result{Width: w, Height: h, Size: s}, nil
}

// writeSiblingTemp writes data to a new ".packrat-thumb-<random><ext>" file in
// the sidecar's own directory (same filesystem, so the final rename is atomic),
// with the sidecar's permissions (0644 when it doesn't exist), and returns its
// path. The file is removed on any error. Abandoned ones (a crash) are removed
// at startup by fsutil.CleanStaleEmbedTemps and ignored by the importer scan.
func writeSiblingTemp(thumbAbs string, data []byte) (string, error) {
	ext := filepath.Ext(thumbAbs)
	if ext == "" {
		ext = ".jpg"
	}
	perm := os.FileMode(0o644)
	if info, err := os.Stat(thumbAbs); err == nil {
		perm = info.Mode().Perm()
	}
	tmp, err := os.CreateTemp(filepath.Dir(thumbAbs), fsutil.ThumbTmpPrefix+"*"+ext)
	if err != nil {
		return "", fmt.Errorf("creating temp thumbnail file: %w", err)
	}
	tmpAbs := tmp.Name()
	fail := func(err error) (string, error) {
		tmp.Close()
		os.Remove(tmpAbs)
		return "", fmt.Errorf("writing temp thumbnail file: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		return fail(err)
	}
	if err := tmp.Sync(); err != nil {
		return fail(err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpAbs)
		return "", fmt.Errorf("writing temp thumbnail file: %w", err)
	}
	if err := os.Chmod(tmpAbs, perm); err != nil {
		os.Remove(tmpAbs)
		return "", fmt.Errorf("writing temp thumbnail file: %w", err)
	}
	return tmpAbs, nil
}

// Probe reads an image file's dimensions (header only, no full decode)
// and byte size. A file that isn't a decodable image wraps ErrNotAnImage.
func Probe(abs string) (width, height int, size int64, err error) {
	info, err := os.Stat(abs)
	if err != nil {
		return 0, 0, 0, err
	}
	f, err := os.Open(abs)
	if err != nil {
		return 0, 0, 0, err
	}
	defer f.Close()

	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("%w: %v", ErrNotAnImage, err)
	}
	return cfg.Width, cfg.Height, info.Size(), nil
}

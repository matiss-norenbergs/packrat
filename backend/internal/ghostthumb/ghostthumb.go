// Package ghostthumb holds the "best-effort thumbnail for a library item that
// has no file yet" helper shared by the api package (Add item, bulk
// "Download thumbnail(s)") and the queue worker (the ghost it creates while a
// download runs). It lives outside api because queue cannot import api.
package ghostthumb

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strconv"

	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/repository"
)

// Tiers are the library thumbnail derivatives every ghost gets.
var Tiers = []imageproc.Tier{
	{Name: "small", MaxWidth: imageproc.ThumbnailSmallWidth},
	{Name: "medium", MaxWidth: imageproc.ThumbnailMediumWidth},
}

// FetchFunc downloads the source image into scratchDir and returns its path.
type FetchFunc func(ctx context.Context, scratchDir string) (string, error)

// Generate fetches a source image into a scratch dir (deleted afterwards),
// tiers it into ImagesRoot WebP derivatives for library item id and records
// them (ThumbnailSmallPath/ThumbnailMediumPath only — the plain Thumbnail
// field is deliberately left untouched, there is no MediaRoot location tied
// to this fetch). Tiers it replaces are removed once the DB points at the new
// ones. Best-effort: returns whether it succeeded, failures are only logged.
func Generate(ctx context.Context, libraryRepo *repository.LibraryRepo, imagesRoot, ffmpegPath string, id int64, fetch FetchFunc) bool {
	tmpDir, err := os.MkdirTemp("", "ghost-thumb-*")
	if err != nil {
		log.Printf("ghost item %d: creating scratch dir for thumbnail fetch failed: %v", id, err)
		return false
	}
	defer os.RemoveAll(tmpDir)

	thumbAbs, err := fetch(ctx, tmpDir)
	if err != nil {
		log.Printf("ghost item %d: thumbnail fetch failed: %v", id, err)
		return false
	}

	tiers, err := imageproc.GenerateTiersFromPath(ctx, ffmpegPath, imagesRoot, "library", id, thumbAbs, Tiers)
	if err != nil {
		log.Printf("ghost item %d: generating thumbnail derivatives failed: %v", id, err)
		return false
	}
	// Snapshot the tiers being replaced so they can be removed once the DB
	// points at the new ones (best-effort; a failed lookup just skips cleanup).
	var oldSmall, oldMedium *string
	if existing, err := libraryRepo.Get(ctx, id); err != nil {
		log.Printf("ghost item %d: loading previous thumbnail tiers failed: %v", id, err)
	} else {
		oldSmall, oldMedium = existing.ThumbnailSmallPath, existing.ThumbnailMediumPath
	}

	var width, height *int
	if w, h, err := imageproc.ProbeDimensions(thumbAbs); err != nil {
		log.Printf("ghost item %d: probing thumbnail dimensions failed: %v", id, err)
	} else {
		width, height = &w, &h
	}
	if err := libraryRepo.UpdateThumbnailTiers(ctx, id, &tiers[0], &tiers[1], width, height); err != nil {
		log.Printf("ghost item %d: saving thumbnail derivatives failed: %v", id, err)
		return false
	}
	RemoveTiers(imagesRoot, oldSmall, oldMedium)
	return true
}

// RemoveTiers removes ImagesRoot-relative derivative files (nil/empty skipped,
// a missing file counts as success).
func RemoveTiers(imagesRoot string, rels ...*string) {
	for _, p := range rels {
		if p == nil || *p == "" {
			continue
		}
		abs := filepath.Join(imagesRoot, filepath.FromSlash(*p))
		if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
			log.Printf("library: failed to delete thumbnail derivative %s: %v", abs, err)
		}
	}
}

// RemoveItemDir removes the whole ImagesRoot/library/<id> directory (thumbnail
// tiers and any AI-enhancement backup). Ids are AUTOINCREMENT, so the
// directory is never reused. A missing directory counts as success.
func RemoveItemDir(imagesRoot string, id int64) {
	dir := filepath.Join(imagesRoot, "library", strconv.FormatInt(id, 10))
	if err := os.RemoveAll(dir); err != nil {
		log.Printf("library: failed to remove directory %s: %v", dir, err)
	}
}

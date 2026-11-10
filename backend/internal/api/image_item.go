package api

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/thumbnailenhance"
)

// errImageItemThumbnail is the 400 message for thumbnail operations that
// would write to or delete the media file of an image item.
const errImageItemThumbnail = "an image item's thumbnail is the image file itself"

// isImageItem reports whether item is a downloaded/imported image. For such
// items the stored Thumbnail IS the media file (see queue buildLibraryItem),
// so anything that writes or deletes "the thumbnail file" would hit the media.
func isImageItem(item *models.LibraryItem) bool {
	return item != nil && item.MediaType != nil && *item.MediaType == "image"
}

// pathIsMedia reports whether abs is the item's media file. Defense in depth:
// no thumbnail write or delete may ever target a path for which it is true.
func pathIsMedia(mediaRoot string, item *models.LibraryItem, abs string) bool {
	if item == nil || item.Path == "" {
		return false
	}
	media := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
	return filepath.Clean(abs) == filepath.Clean(media)
}

// rejectImageItem answers 400 and returns true when item is an image item.
func rejectImageItem(c *gin.Context, item *models.LibraryItem) bool {
	if !isImageItem(item) {
		return false
	}
	c.JSON(http.StatusBadRequest, gin.H{"error": errImageItemThumbnail})
	return true
}

// setImageItemThumbnailTiers is the tiers-only route for image items: data is
// written to a scratch file outside the media folder, tiered into small/medium
// WebP derivatives and recorded. The media file and item.Thumbnail are never
// touched; the original's recorded dimensions are kept (they describe the
// image file, which did not change).
func setImageItemThumbnailTiers(c *gin.Context, libraryRepo *repository.LibraryRepo, responder *ItemResponder, originalsRepo *repository.ThumbnailEnhancementOriginalsRepo, item *models.LibraryItem, imagesRoot, ffmpegPath string, data []byte) {
	ctx := c.Request.Context()

	tmpDir, err := os.MkdirTemp("", "image-item-thumb-*")
	if err != nil {
		writeServerError(c, err)
		return
	}
	defer os.RemoveAll(tmpDir)
	scratch := filepath.Join(tmpDir, "source")
	if err := os.WriteFile(scratch, data, 0o600); err != nil {
		writeServerError(c, err)
		return
	}

	tiers, err := imageproc.GenerateTiersFromPath(ctx, ffmpegPath, imagesRoot, "library", item.ID, scratch, libraryThumbnailTiers)
	if err != nil {
		writeServerError(c, err)
		return
	}
	if err := libraryRepo.UpdateThumbnailTiers(ctx, item.ID, &tiers[0], &tiers[1], item.ThumbnailWidth, item.ThumbnailHeight); err != nil {
		removeThumbnailTiers(imagesRoot, &tiers[0], &tiers[1])
		writeServerError(c, err)
		return
	}
	removeThumbnailTiers(imagesRoot, item.ThumbnailSmallPath, item.ThumbnailMediumPath)

	if err := thumbnailenhance.DeleteOriginal(ctx, thumbnailenhance.Deps{OriginalsRepo: originalsRepo, ImagesRoot: imagesRoot}, item.ID); err != nil && !errors.Is(err, repository.ErrNotFound) {
		log.Printf("library thumbnail: clearing stale AI-enhancement backup for item %d failed: %v", item.ID, err)
	}
	respondWithItem(c, libraryRepo, responder, ctx, item.ID)
}

func respondWithItem(c *gin.Context, libraryRepo *repository.LibraryRepo, responder *ItemResponder, ctx context.Context, id int64) {
	updated, err := libraryRepo.Get(ctx, id)
	if err != nil {
		writeServerError(c, err)
		return
	}
	resp, err := responder.Response(ctx, *updated)
	if err != nil {
		writeServerError(c, err)
		return
	}
	c.JSON(http.StatusOK, resp)
}

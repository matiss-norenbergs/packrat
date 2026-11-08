package api

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// readCurrentThumbnail returns the item's active thumbnail image bytes —
// the full-resolution original under MediaRoot (item.Thumbnail) if present,
// falling back to the best available ImagesRoot derivative for items that
// only have those (e.g. a ghost's fetched thumbnail has no MediaRoot copy,
// see fetchGhostThumbnail). Also returns the source file's extension, since
// the original is a JPEG but derivatives are WebP — the caller needs the
// real extension to save a correctly-labeled copy, not a hardcoded one.
func readCurrentThumbnail(mediaRoot, imagesRoot string, item *models.LibraryItem) (data []byte, ext string, err error) {
	if item.Thumbnail != nil {
		data, err = os.ReadFile(filepath.Join(mediaRoot, filepath.FromSlash(*item.Thumbnail)))
		return data, ".jpg", err
	}
	if item.ThumbnailMediumPath != nil {
		data, err = os.ReadFile(filepath.Join(imagesRoot, filepath.FromSlash(*item.ThumbnailMediumPath)))
		return data, filepath.Ext(*item.ThumbnailMediumPath), err
	}
	if item.ThumbnailSmallPath != nil {
		data, err = os.ReadFile(filepath.Join(imagesRoot, filepath.FromSlash(*item.ThumbnailSmallPath)))
		return data, filepath.Ext(*item.ThumbnailSmallPath), err
	}
	return nil, "", fmt.Errorf("item has no thumbnail")
}

// SaveLibraryThumbnailToGallery saves an image to a library item's
// thumbnail gallery without touching its active thumbnail. Two frontend
// entry points share this one handler:
//   - The Thumbnail submenu's "Save in Thumbnail Gallery" item calls it
//     with no body — a copy of the item's current active thumbnail is
//     saved to the gallery as-is.
//   - The "Choose from Video" dialog's floating per-frame icon calls it
//     with {imageBase64} — the exact bytes already displayed for that
//     candidate, saved as-is.
func SaveLibraryThumbnailToGallery(mediaRoot, imagesRoot string, libraryRepo *repository.LibraryRepo, galleryRepo *repository.ThumbnailGalleryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		item, err := libraryRepo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		var req SaveThumbnailToGalleryRequest
		if c.Request.ContentLength > 0 {
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
		}

		var data []byte
		ext := ".jpg"
		if req.ImageBase64 != "" {
			data, err = base64.StdEncoding.DecodeString(req.ImageBase64)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid image data: " + err.Error()})
				return
			}
		} else {
			data, ext, err = readCurrentThumbnail(mediaRoot, imagesRoot, item)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
		}

		var width, height *int
		if cfg, _, err := image.DecodeConfig(bytes.NewReader(data)); err == nil {
			w, h := cfg.Width, cfg.Height
			width, height = &w, &h
		}

		dir := filepath.Join(imagesRoot, "thumbnail-gallery", strconv.FormatInt(id, 10))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		filename := uuid.NewString() + ext
		abs := filepath.Join(dir, filename)
		if err := os.WriteFile(abs, data, 0o644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		rel := filepath.ToSlash(filepath.Join("thumbnail-gallery", strconv.FormatInt(id, 10), filename))

		galleryID, err := galleryRepo.Create(ctx, id, rel, width, height, req.TimestampSeconds)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		img, err := galleryRepo.Get(ctx, galleryID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, toThumbnailGalleryImageResponse(img))
	}
}

// ListLibraryThumbnailGallery returns an item's saved gallery images.
func ListLibraryThumbnailGallery(libraryRepo *repository.LibraryRepo, galleryRepo *repository.ThumbnailGalleryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		if _, err := libraryRepo.Get(ctx, id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		images, err := galleryRepo.ListByLibraryItemID(ctx, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out := make([]ThumbnailGalleryImageResponse, len(images))
		for i, img := range images {
			out[i] = toThumbnailGalleryImageResponse(img)
		}
		c.JSON(http.StatusOK, gin.H{"images": out})
	}
}

// ApplyLibraryThumbnailFromGallery makes an already-saved gallery image the
// item's active thumbnail — the gallery-side equivalent of SetLibraryThumbnail,
// reusing the same writeThumbnailAndRespond finish (derivatives, stale
// AI-enhancement backup cleanup, response shape).
func ApplyLibraryThumbnailFromGallery(mediaRoot, imagesRoot, ffmpegPath string, libraryRepo *repository.LibraryRepo, galleryRepo *repository.ThumbnailGalleryRepo, responder *ItemResponder, originalsRepo *repository.ThumbnailEnhancementOriginalsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		galleryID, err := strconv.ParseInt(c.Param("galleryId"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid gallery id"})
			return
		}

		img, err := galleryRepo.Get(ctx, galleryID)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "gallery image not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if img.LibraryItemID != id {
			c.JSON(http.StatusBadRequest, gin.H{"error": "gallery image does not belong to this item"})
			return
		}

		item, err := libraryRepo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no media file"})
			return
		}

		data, err := os.ReadFile(filepath.Join(imagesRoot, filepath.FromSlash(img.ImagePath)))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "reading gallery image: " + err.Error()})
			return
		}

		if isImageItem(item) {
			setImageItemThumbnailTiers(c, libraryRepo, responder, originalsRepo, item, imagesRoot, ffmpegPath, data)
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		thumbAbs := thumbnailAbsPathFor(mediaAbs)
		if pathIsMedia(mediaRoot, item, thumbAbs) {
			c.JSON(http.StatusBadRequest, gin.H{"error": errImageItemThumbnail})
			return
		}
		if err := os.WriteFile(thumbAbs, data, 0o644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		writeThumbnailAndRespond(c, libraryRepo, responder, originalsRepo, id, mediaRoot, imagesRoot, ffmpegPath, thumbAbs)
	}
}

// writeGalleryForeign answers the 400 for gallery ids that do not belong to the
// item in the URL.
func writeGalleryForeign(c *gin.Context, foreign []int64) {
	c.JSON(http.StatusBadRequest, gin.H{
		"error":      "gallery images do not belong to this item",
		"invalidIds": foreign,
	})
}

// BulkSetLibraryThumbnailGalleryFavorite is
// POST /api/library/:id/thumbnail/gallery/bulk-favorite: it sets the favorite
// flag of the listed gallery images in one transaction. A gallery id that
// belongs to another item, or does not exist at all, fails the WHOLE request
// with 400 listing the offending ids ("invalidIds") and changes nothing. The
// notDownloading route guard applies to the whole request (409).
func BulkSetLibraryThumbnailGalleryFavorite(galleryRepo *repository.ThumbnailGalleryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		itemID, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		var req BulkGalleryFavoriteRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !checkBulkCount(c, len(req.GalleryIDs)) {
			return
		}
		updated, foreign, missing, err := galleryRepo.SetFavoriteForItem(c.Request.Context(), itemID, dedupeKeepOrder(req.GalleryIDs), req.IsFavorite)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if bad := append(append([]int64{}, foreign...), missing...); len(bad) > 0 {
			writeGalleryForeign(c, bad)
			return
		}
		c.JSON(http.StatusOK, BulkUpdatedResponse{Updated: updated})
	}
}

// BulkDeleteLibraryThumbnailGalleryImages is
// POST /api/library/:id/thumbnail/gallery/bulk-delete: rows are deleted in one
// transaction, and only after the commit are the image files removed, best
// effort. A gallery id that belongs to another item fails the WHOLE request
// with 400 listing the offending ids; ids that do not exist at all are ignored.
func BulkDeleteLibraryThumbnailGalleryImages(imagesRoot string, galleryRepo *repository.ThumbnailGalleryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		itemID, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		var req BulkGalleryDeleteRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !checkBulkCount(c, len(req.GalleryIDs)) {
			return
		}
		removed, foreign, err := galleryRepo.DeleteForItem(c.Request.Context(), itemID, dedupeKeepOrder(req.GalleryIDs))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if len(foreign) > 0 {
			writeGalleryForeign(c, foreign)
			return
		}
		for _, img := range removed {
			abs := filepath.Join(imagesRoot, filepath.FromSlash(img.ImagePath))
			if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
				log.Printf("thumbnail gallery: failed to delete %s: %v", abs, err)
			}
		}
		c.JSON(http.StatusOK, BulkDeleteResponse{Deleted: len(removed)})
	}
}

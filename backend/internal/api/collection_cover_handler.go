package api

import (
	"errors"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/importer"
	"packrat/backend/internal/models"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/repository"
)

var coverImageTiers = []imageproc.Tier{
	{Name: "small", MaxWidth: imageproc.ThumbnailSmallWidth},
	{Name: "medium", MaxWidth: imageproc.ThumbnailMediumWidth},
	{Name: "original", MaxWidth: imageproc.CoverOriginalWidth},
}

// removeCoverFiles best-effort deletes every tier file for a collection's
// current cover — used both when replacing (old files no longer referenced)
// and when clearing.
func removeCoverFiles(imagesRoot string, c *models.Collection) {
	for _, p := range []*string{c.CoverImagePath, c.CoverImageSmallPath, c.CoverImageMediumPath} {
		if p == nil {
			continue
		}
		abs := filepath.Join(imagesRoot, filepath.FromSlash(*p))
		if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
			log.Printf("collection cover: failed to delete old cover file %s: %v", abs, err)
		}
	}
}

// CollectionCoverCandidates scans the collection's own resolved folder, full
// depth, for image files already sitting among its downloaded content —
// read-only, nothing copied yet.
func CollectionCoverCandidates(mediaRoot string, collectionsRepo *repository.CollectionsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		relDir, err := collectionsRepo.ResolvePath(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		absDir, err := pathsafe.ResolveUnderRoot(mediaRoot, relDir)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		images, err := importer.ScanImages(absDir)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		out := make([]CollectionCoverCandidateResponse, 0, len(images))
		for _, img := range images {
			out = append(out, CollectionCoverCandidateResponse{RelPath: path.Join(relDir, img.RelPath)})
		}
		c.JSON(http.StatusOK, gin.H{"candidates": out})
	}
}

// SetCollectionCover generates small/medium/original WebP derivatives from a
// new cover image (from an existing file or a fresh upload) into the
// collection's own images folder, replacing whatever was there before —
// always safe to delete-and-replace since this is Packrat's own copy, never
// the user's original media.
func SetCollectionCover(mediaRoot, imagesRoot, ffmpegPath string, collectionsRepo *repository.CollectionsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		existing, err := collectionsRepo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		var req SetCollectionCoverRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		data, nameHint, err := resolveImageSourceBytes(mediaRoot, req.SourceRelPath, req.ImageBase64, req.Filename)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		tiers, err := imageproc.GenerateTiers(ctx, ffmpegPath, imagesRoot, "collections", id, data, nameHint, coverImageTiers)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		small, medium, original := tiers[0], tiers[1], tiers[2]

		// Clean up the old files now that the DB will stop pointing at them.
		removeCoverFiles(imagesRoot, existing)

		if err := collectionsRepo.SetCoverImageTiers(ctx, id, &small, &medium, &original); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		updated, err := collectionsRepo.Get(ctx, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"coverImagePath":       updated.CoverImagePath,
			"coverImageSmallPath":  updated.CoverImageSmallPath,
			"coverImageMediumPath": updated.CoverImageMediumPath,
		})
	}
}

// DeleteCollectionCover removes the collection's cover — all tier files
// (best-effort) and the DB references.
func DeleteCollectionCover(imagesRoot string, collectionsRepo *repository.CollectionsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		existing, err := collectionsRepo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		removeCoverFiles(imagesRoot, existing)

		if err := collectionsRepo.SetCoverImageTiers(ctx, id, nil, nil, nil); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

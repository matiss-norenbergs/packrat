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
	"github.com/google/uuid"

	"packrat/backend/internal/importer"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/repository"
)

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

// SetCollectionCover copies a new cover image (from an existing file or a
// fresh upload) into the collection's own images folder, replacing whatever
// was there before — always safe to delete-and-replace since this is
// Packrat's own copy, never the user's original media.
func SetCollectionCover(mediaRoot, imagesRoot string, collectionsRepo *repository.CollectionsRepo) gin.HandlerFunc {
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

		destDir := filepath.Join(imagesRoot, "collections", strconv.FormatInt(id, 10))
		if err := os.MkdirAll(destDir, 0o755); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// Unique per-upload filename (not a fixed "cover.<ext>") so the
		// <img src> URL always changes when the cover is replaced — a fixed
		// name would let the browser keep showing the old cached bytes
		// after a same-extension replacement, since React never sees the
		// src prop change. Same convention as artist images.
		destAbs := filepath.Join(destDir, uuid.NewString()+imageExtFor(nameHint))
		if err := os.WriteFile(destAbs, data, 0o644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		destRel := toRelSlash(imagesRoot, destAbs)

		// Clean up the old file now that the DB will stop pointing at it.
		if existing.CoverImagePath != nil && *existing.CoverImagePath != destRel {
			oldAbs := filepath.Join(imagesRoot, filepath.FromSlash(*existing.CoverImagePath))
			if err := os.Remove(oldAbs); err != nil && !os.IsNotExist(err) {
				log.Printf("collection cover: failed to delete old cover file %s: %v", oldAbs, err)
			}
		}

		if err := collectionsRepo.SetCoverImage(ctx, id, &destRel); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		updated, err := collectionsRepo.Get(ctx, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"coverImagePath": updated.CoverImagePath})
	}
}

// DeleteCollectionCover removes the collection's cover — the file
// (best-effort) and the DB reference.
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

		if existing.CoverImagePath != nil {
			abs := filepath.Join(imagesRoot, filepath.FromSlash(*existing.CoverImagePath))
			if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
				log.Printf("collection cover: failed to delete cover file %s: %v", abs, err)
			}
		}

		if err := collectionsRepo.SetCoverImage(ctx, id, nil); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

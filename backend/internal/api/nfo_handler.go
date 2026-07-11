package api

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/nfo"
	"packrat/backend/internal/repository"
)

// nfoAbsPathFor returns the sidecar .nfo path for a media file — same
// basename, .nfo extension — mirroring thumbnailAbsPathFor's convention
// (thumbnail_handler.go), which Jellyfin also expects for per-file sidecars.
func nfoAbsPathFor(mediaAbs string) string {
	ext := filepath.Ext(mediaAbs)
	return mediaAbs[:len(mediaAbs)-len(ext)] + ".nfo"
}

// writeNFO builds and writes item's .nfo sidecar to disk, overwriting
// whatever is there. Shared by the manual "Generate NFO Now" action and
// every metadata-editing handler that keeps an opted-in item's NFO in sync
// (UpdateLibraryItem, RefreshLibraryItemMetadata, RedownloadLibraryItem).
func writeNFO(ctx context.Context, mediaRoot string, tagsRepo *repository.TagsRepo, item *models.LibraryItem) error {
	tags, err := tagsRepo.TagsForLibraryItem(ctx, item.ID)
	if err != nil {
		return fmt.Errorf("loading tags for nfo: %w", err)
	}
	mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
	doc := nfo.Build(*item, tags)
	if err := os.WriteFile(nfoAbsPathFor(mediaAbs), doc, 0o644); err != nil {
		return fmt.Errorf("writing nfo file: %w", err)
	}
	return nil
}

// GenerateLibraryItemNFO writes (or overwrites) the item's .nfo sidecar
// on demand — useful right after first enabling "Generate NFO" on an item,
// or any time the user wants to force a refresh outside the normal
// auto-sync-on-edit flow.
func GenerateLibraryItemNFO(mediaRoot string, libraryRepo *repository.LibraryRepo, tagsRepo *repository.TagsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		item, err := libraryRepo.Get(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
			return
		}
		if !item.GenerateNFO {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Generate NFO is not enabled for this item"})
			return
		}

		if err := writeNFO(c.Request.Context(), mediaRoot, tagsRepo, item); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// GetLibraryItemNFO returns the raw XML contents of an item's .nfo sidecar,
// for the "View Contents" action — 404 if no file has been generated yet
// (e.g. the toggle was just turned on but nothing's been written, or it was
// deleted via the "Delete File" action).
func GetLibraryItemNFO(mediaRoot string, libraryRepo *repository.LibraryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		item, err := libraryRepo.Get(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		content, err := os.ReadFile(nfoAbsPathFor(mediaAbs))
		if err != nil {
			if os.IsNotExist(err) {
				c.JSON(http.StatusNotFound, gin.H{"error": "no .nfo file has been generated for this item"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"content": string(content)})
	}
}

// DeleteLibraryItemNFO removes an item's .nfo sidecar from disk, for the
// "Delete File" action. This is a one-off disk cleanup — it does not touch
// the GenerateNFO toggle, so the file reappears on the next relevant edit if
// the toggle is still on (same as any other auto-synced field); turning the
// file off for good means unchecking "Generate NFO" in Edit instead.
// Idempotent: a missing file is treated as already-deleted, not an error.
func DeleteLibraryItemNFO(mediaRoot string, libraryRepo *repository.LibraryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		item, err := libraryRepo.Get(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		if err := os.Remove(nfoAbsPathFor(mediaAbs)); err != nil && !os.IsNotExist(err) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

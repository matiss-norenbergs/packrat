package api

import (
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"packrat/backend/internal/repository"
)

// ArtistImageCandidates lists that artist's downloaded items' thumbnails as
// suggested images to add to the gallery — read-only, nothing copied yet.
func ArtistImageCandidates(libraryRepo *repository.LibraryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		thumbnails, err := libraryRepo.ThumbnailsByArtist(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		out := make([]ArtistImageCandidateResponse, 0, len(thumbnails))
		for _, relPath := range thumbnails {
			out = append(out, ArtistImageCandidateResponse{RelPath: relPath})
		}
		c.JSON(http.StatusOK, gin.H{"candidates": out})
	}
}

// ListArtistImages returns an artist's full image gallery.
func ListArtistImages(artistsRepo *repository.ArtistsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		images, err := artistsRepo.ListImages(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		out := make([]ArtistImageResponse, 0, len(images))
		for _, img := range images {
			out = append(out, toArtistImageResponse(img))
		}
		c.JSON(http.StatusOK, out)
	}
}

// AddArtistImage copies a new image (from an existing file or a fresh
// upload) into that artist's gallery folder and records it.
func AddArtistImage(mediaRoot, imagesRoot string, artistsRepo *repository.ArtistsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		if _, err := artistsRepo.Get(ctx, id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "artist not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		var req SetArtistImageRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		data, nameHint, err := resolveImageSourceBytes(mediaRoot, req.SourceRelPath, req.ImageBase64, req.Filename)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		destDir := filepath.Join(imagesRoot, "artists", strconv.FormatInt(id, 10))
		if err := os.MkdirAll(destDir, 0o755); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		destAbs := filepath.Join(destDir, uuid.NewString()+imageExtFor(nameHint))
		if err := os.WriteFile(destAbs, data, 0o644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		img, err := artistsRepo.AddImage(ctx, id, toRelSlash(imagesRoot, destAbs))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, toArtistImageResponse(*img))
	}
}

// DeleteArtistImage removes one gallery image — the file (best-effort) and
// its row — clearing the artist's selection first if it pointed at this one.
func DeleteArtistImage(imagesRoot string, artistsRepo *repository.ArtistsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		artistID, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		imageID, err := strconv.ParseInt(c.Param("imageId"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid image id"})
			return
		}

		artist, err := artistsRepo.Get(ctx, artistID)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "artist not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		relPath, err := artistsRepo.DeleteImage(ctx, imageID)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "image not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		abs := filepath.Join(imagesRoot, filepath.FromSlash(relPath))
		if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
			log.Printf("artist images: failed to delete image file %s: %v", abs, err)
		}

		if artist.SelectedImagePath != nil && *artist.SelectedImagePath == relPath {
			if err := artistsRepo.SetSelectedImage(ctx, artistID, nil); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		c.Status(http.StatusNoContent)
	}
}

// SelectArtistImage sets one of the artist's existing gallery images as
// their display picture.
func SelectArtistImage(artistsRepo *repository.ArtistsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		artistID, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		imageID, err := strconv.ParseInt(c.Param("imageId"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid image id"})
			return
		}

		img, err := artistsRepo.GetImage(ctx, imageID)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "image not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if img.ArtistID != artistID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "image does not belong to this artist"})
			return
		}

		if err := artistsRepo.SetSelectedImage(ctx, artistID, &img.RelativePath); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "artist not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// ClearArtistSelectedImage reverts the artist to no explicit display
// picture (Browse then falls back to an auto-picked image) — the gallery
// image itself, if any, is left untouched.
func ClearArtistSelectedImage(artistsRepo *repository.ArtistsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		artistID, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		if err := artistsRepo.SetSelectedImage(c.Request.Context(), artistID, nil); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "artist not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

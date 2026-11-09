package api

import (
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/repository"
)

// Artist images are a single tier (no small/medium split) — "image" rather
// than "original" since the stored file is always resized to
// ArtistImageWidth, never the untouched upload.
var artistImageTiers = []imageproc.Tier{{Name: "image", MaxWidth: imageproc.ArtistImageWidth}}

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
			writeServerError(c, err)
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
			writeServerError(c, err)
			return
		}

		out := make([]ArtistImageResponse, 0, len(images))
		for _, img := range images {
			out = append(out, toArtistImageResponse(img))
		}
		c.JSON(http.StatusOK, out)
	}
}

// AddArtistImage generates a single WebP derivative (from an existing file
// or a fresh upload) into that artist's gallery folder and records it.
func AddArtistImage(mediaRoot, imagesRoot, ffmpegPath string, artistsRepo *repository.ArtistsRepo) gin.HandlerFunc {
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
			writeServerError(c, err)
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

		tiers, err := imageproc.GenerateTiers(ctx, ffmpegPath, imagesRoot, "artists", id, data, nameHint, artistImageTiers)
		if err != nil {
			writeServerError(c, err)
			return
		}

		img, err := artistsRepo.AddImage(ctx, id, tiers[0])
		if err != nil {
			writeServerError(c, err)
			return
		}
		c.JSON(http.StatusCreated, toArtistImageResponse(*img))
	}
}

// DeleteArtistImage removes one of the artist's gallery images — its row and,
// best-effort after the commit, its file — clearing the artist's selection in
// the same transaction when it pointed at this image. The image must belong to
// the artist in the URL (400 otherwise, nothing deleted), like SelectArtistImage.
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

		if _, err := artistsRepo.Get(ctx, artistID); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "artist not found"})
				return
			}
			writeServerError(c, err)
			return
		}

		img, err := artistsRepo.GetImage(ctx, imageID)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "image not found"})
				return
			}
			writeServerError(c, err)
			return
		}
		if img.ArtistID != artistID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "image does not belong to this artist"})
			return
		}

		// Row delete + selection clear in one transaction; the repo re-checks
		// ownership, so a concurrent change between the two reads is caught too.
		relPath, err := artistsRepo.DeleteImageForArtist(ctx, artistID, imageID)
		if err != nil {
			switch {
			case errors.Is(err, repository.ErrNotFound):
				c.JSON(http.StatusNotFound, gin.H{"error": "image not found"})
			case errors.Is(err, repository.ErrArtistImageNotOwned):
				c.JSON(http.StatusBadRequest, gin.H{"error": "image does not belong to this artist"})
			default:
				writeServerError(c, err)
			}
			return
		}

		abs := filepath.Join(imagesRoot, filepath.FromSlash(relPath))
		if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
			log.Printf("artist images: failed to delete image file %s: %v", abs, err)
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
			writeServerError(c, err)
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
			writeServerError(c, err)
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
			writeServerError(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	}
}

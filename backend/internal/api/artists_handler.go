package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/repository"
)

func ListArtists(repo *repository.ArtistsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := repo.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out := make([]ArtistResponse, 0, len(rows))
		for _, a := range rows {
			out = append(out, toArtistResponse(a))
		}
		c.JSON(http.StatusOK, out)
	}
}

func CreateArtist(repo *repository.ArtistsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateArtistRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		artist, err := repo.Create(c.Request.Context(), req.Name)
		if err != nil {
			if errors.Is(err, repository.ErrArtistNameInUse) {
				c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"id": artist.ID})
	}
}

func UpdateArtist(repo *repository.ArtistsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		var req UpdateArtistRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := repo.Rename(c.Request.Context(), id, req.Name); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "artist not found"})
				return
			}
			if errors.Is(err, repository.ErrArtistNameInUse) {
				c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func DeleteArtist(repo *repository.ArtistsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		if err := repo.Delete(c.Request.Context(), id); err != nil {
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

// BulkDeleteArtists deletes every listed artist, best-effort — an id that's
// already gone (ErrNotFound) is skipped rather than failing the batch,
// since deleting an artist never fails for being "in use" (references are
// nulled out via ON DELETE SET NULL, not blocked).
func BulkDeleteArtists(repo *repository.ArtistsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BulkDeleteRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		var resp BulkDeleteResponse
		for _, id := range req.IDs {
			if err := repo.Delete(c.Request.Context(), id); err != nil {
				if errors.Is(err, repository.ErrNotFound) {
					continue
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			resp.Deleted++
		}
		c.JSON(http.StatusOK, resp)
	}
}

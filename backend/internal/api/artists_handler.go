package api

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/repository"
)

// validateBirthday checks that a birthday, if given, is a valid date-only
// string ("2006-01-02") — the format an <input type="date"> always submits.
// nil (unset) is always valid.
func validateBirthday(birthday *string) error {
	if birthday == nil || *birthday == "" {
		return nil
	}
	if _, err := time.Parse("2006-01-02", *birthday); err != nil {
		return errors.New("invalid birthday: expected YYYY-MM-DD")
	}
	return nil
}

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
		if err := validateBirthday(req.Birthday); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		artist, err := repo.Create(c.Request.Context(), req.Name, req.Birthday)
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
		if err := validateBirthday(req.Birthday); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := repo.Update(c.Request.Context(), id, req.Name, req.Birthday); err != nil {
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
// nulled out via ON DELETE SET NULL, not blocked). The deletes run inside
// one transaction, so a genuine mid-batch failure rolls back every row
// already deleted instead of leaving a partial batch.
func BulkDeleteArtists(db *sql.DB, repo *repository.ArtistsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BulkDeleteRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer tx.Rollback()
		txRepo := repo.WithTx(tx)

		var resp BulkDeleteResponse
		for _, id := range req.IDs {
			if err := txRepo.Delete(c.Request.Context(), id); err != nil {
				if errors.Is(err, repository.ErrNotFound) {
					continue
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			resp.Deleted++
		}

		if err := tx.Commit(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, resp)
	}
}

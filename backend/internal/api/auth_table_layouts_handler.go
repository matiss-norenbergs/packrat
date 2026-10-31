package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// GetTableLayouts returns every saved layout of the signed-in user, by table id.
func GetTableLayouts(repo *repository.UserTableLayoutsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		all, err := repo.GetAll(c.Request.Context(), currentSession(c).UserID)
		if err != nil {
			internalError(c, err)
			return
		}
		layouts := make(map[string]json.RawMessage, len(all))
		for id, l := range all {
			layouts[id] = json.RawMessage(l)
		}
		c.JSON(http.StatusOK, TableLayoutsResponse{Layouts: layouts})
	}
}

// PutTableLayout replaces the layout of one table and returns it canonicalized. An invalid
// tableId or layout is 400 and nothing is stored; a new table over the per-account cap is 409.
func PutTableLayout(repo *repository.UserTableLayoutsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		tableID := c.Param("tableId")
		if !models.ValidTableID(tableID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid table id"})
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, models.TableLayoutMaxBytes+1))
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("layout is larger than %d bytes", models.TableLayoutMaxBytes)})
				return
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
			return
		}
		layout, err := models.ParseTableLayout(body)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := repo.Set(c.Request.Context(), currentSession(c).UserID, tableID, layout); err != nil {
			if errors.Is(err, repository.ErrTooManyTableLayouts) {
				c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("at most %d table layouts can be saved", models.MaxTableLayoutsPerUser)})
				return
			}
			internalError(c, err)
			return
		}
		c.Data(http.StatusOK, "application/json; charset=utf-8", []byte(layout))
	}
}

// DeleteTableLayout removes the saved layout of one table. Idempotent: 204 either way.
func DeleteTableLayout(repo *repository.UserTableLayoutsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		tableID := c.Param("tableId")
		if !models.ValidTableID(tableID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid table id"})
			return
		}
		if err := repo.Delete(c.Request.Context(), currentSession(c).UserID, tableID); err != nil {
			internalError(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	}
}

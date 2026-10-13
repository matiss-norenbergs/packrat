package api

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/strayfiles"
)

// ScanStrayFiles is the report-only half of the Settings "Find stray files"
// tool — it never deletes anything. See package strayfiles for the rules.
func ScanStrayFiles(db *sql.DB, mediaRoot, imagesRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		res, err := strayfiles.Scan(c.Request.Context(), strayfiles.Config{DB: db, MediaRoot: mediaRoot, ImagesRoot: imagesRoot}, time.Now())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
	}
}

// DeleteStrayFiles removes the requested entries, re-checking each one is
// still stray at delete time (the client's list is never trusted).
func DeleteStrayFiles(db *sql.DB, mediaRoot, imagesRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req DeleteStrayFilesRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		deleted, skipped, err := strayfiles.Delete(c.Request.Context(), strayfiles.Config{DB: db, MediaRoot: mediaRoot, ImagesRoot: imagesRoot}, req.Paths, time.Now())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, DeleteStrayFilesResponse{Deleted: deleted, Skipped: skipped})
	}
}

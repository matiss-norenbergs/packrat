package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/imagebackfill"
)

// StartImageBackfill kicks off the background image-derivative backfill (a
// no-op if one is already running) and returns the current status either
// way — the frontend polls GetImageBackfillStatus while running is true.
func StartImageBackfill(mgr *imagebackfill.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		mgr.Start()
		c.JSON(http.StatusOK, mgr.Status())
	}
}

// GetImageBackfillStatus reports the current/last backfill run's progress.
func GetImageBackfillStatus(mgr *imagebackfill.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, mgr.Status())
	}
}

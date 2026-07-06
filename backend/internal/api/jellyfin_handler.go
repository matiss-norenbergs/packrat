package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/jellyfin"
	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// RescanJellyfinLibrary triggers a full Jellyfin library scan on demand —
// there is no automatic trigger (see JellyfinCard in the frontend and the
// removed queue/import call sites): a burst of downloads would otherwise
// mean a burst of rescans, so the user decides when to rescan instead.
// Unlike the old fire-and-forget path, a manual click surfaces success or
// failure directly to the caller rather than only logging it.
func RescanJellyfinLibrary(settingsRepo *repository.SettingsRepo, jellyfinClient *jellyfin.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()

		enabled, err := JellyfinEnabled(ctx, settingsRepo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if !enabled {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Jellyfin integration is not enabled"})
			return
		}

		baseURL, err := settingsRepo.Get(ctx, models.SettingJellyfinURL)
		if err != nil || baseURL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Jellyfin URL is not set"})
			return
		}
		apiKey, err := settingsRepo.Get(ctx, models.SettingJellyfinAPIKey)
		if err != nil || apiKey == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Jellyfin API key is not set"})
			return
		}

		if err := jellyfinClient.RefreshFull(ctx, baseURL, apiKey); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

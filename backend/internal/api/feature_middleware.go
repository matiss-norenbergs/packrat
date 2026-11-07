package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/features"
	"packrat/backend/internal/repository"
)

// RequireFeature rejects a request with 403 while the feature behind
// settingKey (a models.SettingFeature* constant) is switched off in
// Settings → Features. The UI hides a disabled feature's entry points; this
// is the backstop for stale tabs and direct API calls. The setting is read
// per request so a toggle takes effect immediately.
func RequireFeature(repo *repository.SettingsRepo, settingKey, name string) gin.HandlerFunc {
	return RequireFeatureIn(repo, settingKey, name, "Settings → Features")
}

// RequireFeatureIn is RequireFeature for a switch that lives elsewhere in Settings (the system log's
// is in History); where names that place in the error message.
func RequireFeatureIn(repo *repository.SettingsRepo, settingKey, name, where string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !features.Enabled(c.Request.Context(), repo, settingKey) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   name + " is turned off in " + where,
				"feature": settingKey,
			})
			return
		}
		c.Next()
	}
}

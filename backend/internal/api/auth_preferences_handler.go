package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

func preferencesResponse(m map[string]string) UserPreferencesResponse {
	return UserPreferencesResponse{Theme: m[models.PrefTheme], Accent: m[models.PrefAccent]}
}

// GetPreferences returns the signed-in user's UI preferences (both keys, defaults for unset ones).
func GetPreferences(repo *repository.UserPreferencesRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		prefs, err := repo.GetAll(c.Request.Context(), currentSession(c).UserID)
		if err != nil {
			internalError(c, err)
			return
		}
		c.JSON(http.StatusOK, preferencesResponse(prefs))
	}
}

// UpdatePreferences changes only the keys present in the body and returns the full result. Unknown
// keys, non-string values and values outside the allowlist are 400; so is an empty body.
func UpdatePreferences(repo *repository.UserPreferencesRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body map[string]any
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON body"})
			return
		}
		if len(body) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no preferences provided"})
			return
		}
		changes := make(map[string]string, len(body))
		for k, raw := range body {
			spec, known := models.UserPreferenceSpecs[k]
			if !known {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("unknown preference %q", k)})
				return
			}
			v, isString := raw.(string)
			if !isString || !models.ValidUserPreference(k, v) {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid value for %q (allowed: %v)", k, spec.Allowed)})
				return
			}
			changes[k] = v
		}
		userID := currentSession(c).UserID
		if err := repo.Set(c.Request.Context(), userID, changes); err != nil {
			internalError(c, err)
			return
		}
		prefs, err := repo.GetAll(c.Request.Context(), userID)
		if err != nil {
			internalError(c, err)
			return
		}
		c.JSON(http.StatusOK, preferencesResponse(prefs))
	}
}

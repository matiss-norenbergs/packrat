package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/version"
)

type AppVersionResponse struct {
	Version         string  `json:"version"`
	LatestVersion   *string `json:"latestVersion"` // nil if the GitHub lookup failed
	UpdateAvailable bool    `json:"updateAvailable"`
}

// GetVersion reports Packrat's own release version and, best-effort, the
// latest version published on GitHub — not sensitive, so it lives in the
// public route group alongside /health rather than requiring a session, the
// same way an unauthenticated login page might still want to show what it's
// running. A failure to reach GitHub never fails the request — it just
// leaves LatestVersion nil and UpdateAvailable false, mirroring the yt-dlp
// version check's "can't check for updates right now" handling.
func GetVersion() gin.HandlerFunc {
	return func(c *gin.Context) {
		resp := AppVersionResponse{Version: version.Version}
		if latest, err := version.Latest(c.Request.Context()); err == nil {
			resp.LatestVersion = &latest
			resp.UpdateAvailable = version.Version != "dev" && version.Version != latest
		}
		c.JSON(http.StatusOK, resp)
	}
}

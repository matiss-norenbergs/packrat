package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
)

type YtDlpVersionResponse struct {
	CurrentVersion  string  `json:"currentVersion"`
	LatestVersion   *string `json:"latestVersion"` // nil if the PyPI lookup failed
	UpdateAvailable bool    `json:"updateAvailable"`
}

// GetYtDlpVersion reports the installed yt-dlp version and, best-effort, the latest version
// published on PyPI. A failure to reach PyPI never fails the whole request — it just leaves
// LatestVersion nil and UpdateAvailable false, since "can't check for updates right now" isn't
// the same failure as "yt-dlp itself is broken."
func GetYtDlpVersion(ytdlp *downloader.YtDlpService) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()

		current, err := ytdlp.Version(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		resp := YtDlpVersionResponse{CurrentVersion: current}
		if latest, err := ytdlp.LatestVersion(ctx); err == nil {
			resp.LatestVersion = &latest
			resp.UpdateAvailable = !downloader.VersionsEqual(current, latest)
		}

		c.JSON(http.StatusOK, resp)
	}
}

// UpdateYtDlp upgrades yt-dlp via pip and reports the resulting version. Unlike the debounced,
// log-only Jellyfin auto-refresh, this is always a direct user action (a button click), so
// failures are surfaced straight back to the caller rather than just logged.
func UpdateYtDlp(ytdlp *downloader.YtDlpService) gin.HandlerFunc {
	return func(c *gin.Context) {
		version, err := ytdlp.Update(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"version": version})
	}
}

package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/sysevents"
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
			writeServerError(c, err)
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
//
// The update itself is single-flight (a second request gets 409) and runs detached from the
// request: closing the tab never interrupts pip, and the result is still recorded in the system
// log, so the user simply sees the new version when they come back.
func UpdateYtDlp(ytdlp *downloader.YtDlpService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Detached for the same reason as the update: a cancelled request must not drop the event.
		ctx := context.WithoutCancel(c.Request.Context())
		before, _ := ytdlp.Version(ctx)
		version, err := ytdlp.Update(ctx)
		if errors.Is(err, downloader.ErrUpdateInProgress) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		if err != nil {
			eventsOf(c).Record(ctx, sysevents.LevelError, sysevents.CategoryYtdlp, "yt-dlp update failed",
				map[string]any{"versionBefore": before, "error": maskedError(err)})
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		eventsOf(c).Record(ctx, sysevents.LevelInfo, sysevents.CategoryYtdlp, "yt-dlp updated",
			map[string]any{"versionBefore": before, "versionAfter": version})
		c.JSON(http.StatusOK, gin.H{"version": version})
	}
}

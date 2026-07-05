package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/repository"
)

// GetLogs returns the most recent downloads (command/exit-code/tail
// debugging view). Capped here rather than in DownloadsRepo.List, since
// List also backs the live /api/downloads queue view, which must never
// silently truncate.
func GetLogs(downloadsRepo *repository.DownloadsRepo, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := downloadsRepo.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if len(rows) > 200 {
			rows = rows[:200]
		}
		anonymize, err := HistoryAnonymizeURLs(c.Request.Context(), settingsRepo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out := make([]LogEntryResponse, 0, len(rows))
		for _, d := range rows {
			out = append(out, toLogEntryResponse(d, anonymize))
		}
		c.JSON(http.StatusOK, out)
	}
}

package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/repository"
)

// logsLimit is how many of the newest downloads GET /api/logs returns.
const logsLimit = 200

// GetLogs returns the most recent downloads (command/exit-code/tail
// debugging view). The cap is applied in SQL (ListRecent) so the cost follows
// the 200 rows returned, not the size of the downloads table; the live
// /api/downloads queue view uses ListLight and must never truncate.
func GetLogs(downloadsRepo *repository.DownloadsRepo, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := downloadsRepo.ListRecent(c.Request.Context(), logsLimit)
		if err != nil {
			writeServerError(c, err)
			return
		}
		anonymize, err := HistoryAnonymizeURLs(c.Request.Context(), settingsRepo)
		if err != nil {
			writeServerError(c, err)
			return
		}
		out := make([]LogEntryResponse, 0, len(rows))
		for _, d := range rows {
			out = append(out, toLogEntryResponse(d, anonymize))
		}
		c.JSON(http.StatusOK, out)
	}
}

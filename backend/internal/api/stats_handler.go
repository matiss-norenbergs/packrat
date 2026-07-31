package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/repository"
)

func GetStats(downloadsRepo *repository.DownloadsRepo, libraryRepo *repository.LibraryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		active, queued, completedToday, err := downloadsRepo.Stats(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		videoCount, audioCount, totalBytes, err := libraryRepo.Stats(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, StatsResponse{
			ActiveDownloads:   active,
			QueuedDownloads:   queued,
			CompletedToday:    completedToday,
			LibraryVideoCount: videoCount,
			LibraryAudioCount: audioCount,
			TotalStorageBytes: totalBytes,
		})
	}
}

// LibraryGrowthPointResponse is one day's tally plus a running cumulative
// total computed over the item's *entire* history, not just the returned
// range — GrowthByDay has no windowing, so this is always the true total.
type LibraryGrowthPointResponse struct {
	Date       string `json:"date"`
	Count      int    `json:"count"`
	Cumulative int    `json:"cumulative"`
}

// GetLibraryGrowth powers the dashboard's growth-over-time chart.
func GetLibraryGrowth(libraryRepo *repository.LibraryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		points, err := libraryRepo.GrowthByDay(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		out := make([]LibraryGrowthPointResponse, len(points))
		cumulative := 0
		for i, p := range points {
			cumulative += p.Count
			out[i] = LibraryGrowthPointResponse{Date: p.Date, Count: p.Count, Cumulative: cumulative}
		}
		c.JSON(http.StatusOK, out)
	}
}

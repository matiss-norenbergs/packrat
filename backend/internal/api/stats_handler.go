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

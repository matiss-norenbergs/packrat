package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/shirou/gopsutil/v4/disk"

	"packrat/backend/internal/repository"
)

func GetStats(downloadsRepo *repository.DownloadsRepo, libraryRepo *repository.LibraryRepo, mediaRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		active, queued, completedToday, err := downloadsRepo.Stats(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		videoCount, audioCount, videoGhostCount, audioGhostCount, totalBytes, err := libraryRepo.Stats(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// Disk usage is best-effort: an unreadable/unsupported filesystem
		// shouldn't take down the whole dashboard, it just leaves the
		// storage chart without total/free figures.
		var diskTotal, diskFree int64
		if usage, err := disk.UsageWithContext(c.Request.Context(), mediaRoot); err == nil {
			diskTotal = int64(usage.Total)
			diskFree = int64(usage.Free)
		}

		c.JSON(http.StatusOK, StatsResponse{
			ActiveDownloads:   active,
			QueuedDownloads:   queued,
			CompletedToday:    completedToday,
			LibraryVideoCount:      videoCount,
			LibraryAudioCount:      audioCount,
			LibraryVideoGhostCount: videoGhostCount,
			LibraryAudioGhostCount: audioGhostCount,
			TotalStorageBytes:      totalBytes,
			DiskTotalBytes:    diskTotal,
			DiskFreeBytes:     diskFree,
		})
	}
}

// ResolutionBreakdownPointResponse is one standard resolution step's item
// count for the dashboard's resolution-breakdown chart. Steps with zero
// items are included too (Count: 0) so the chart always renders a
// consistent, fully-labeled set of bars.
type ResolutionBreakdownPointResponse struct {
	Step  int `json:"step"`
	Count int `json:"count"`
}

// GetResolutionBreakdown powers the dashboard's resolution-breakdown chart.
func GetResolutionBreakdown(libraryRepo *repository.LibraryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		points, err := libraryRepo.CountByResolutionStep(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		counts := make(map[int]int, len(points))
		for _, p := range points {
			counts[p.Step] = p.Count
		}
		out := make([]ResolutionBreakdownPointResponse, len(repository.ResolutionSteps))
		for i, step := range repository.ResolutionSteps {
			out[i] = ResolutionBreakdownPointResponse{Step: step, Count: counts[step]}
		}
		c.JSON(http.StatusOK, out)
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

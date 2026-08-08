package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/thumbnailenhance"
)

// thumbnailEnhancementProbeTimeout bounds both the ad-hoc "Load models" test
// and the status badge's reachability probe — short enough that a dead/
// unreachable URL fails fast instead of hanging the request.
const thumbnailEnhancementProbeTimeout = 10 * time.Second

// ListThumbnailEnhancementHistory backs the AI Enhancement page's history
// table — every attempted item, most recent first. Enriches each row with
// the item's *current* backup state (has one? what are the compare-dialog
// image paths?) via one extra bulk query each, rather than an N+1 lookup
// per row.
func ListThumbnailEnhancementHistory(deps thumbnailenhance.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		entries, err := deps.HistoryRepo.List(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		withBackup, err := deps.OriginalsRepo.ListItemIDsWithBackup(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		items, err := deps.LibraryRepo.List(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		itemsByID := make(map[int64]models.LibraryItem, len(items))
		for _, item := range items {
			itemsByID[item.ID] = item
		}

		originalPathCache := make(map[int64]string, len(withBackup))
		out := make([]ThumbnailEnhancementHistoryResponse, 0, len(entries))
		for _, e := range entries {
			var hasBackup bool
			var originalPath, enhancedPath *string
			if e.LibraryItemID != nil {
				hasBackup = withBackup[*e.LibraryItemID]
				if item, ok := itemsByID[*e.LibraryItemID]; ok {
					// The raw sidecar file, not a downscaled WebP tier — the
					// whole point of Compare is judging the actual
					// enhancement result, so it needs to match originalPath's
					// full resolution (the backup is also unscaled).
					// Relative to MediaRoot, unlike originalPath which is
					// relative to ImagesRoot; the frontend serves it via
					// mediaFileUrl() accordingly.
					enhancedPath = item.Thumbnail
				}
			}
			if hasBackup {
				path, cached := originalPathCache[*e.LibraryItemID]
				if !cached {
					if p, err := deps.OriginalsRepo.Get(ctx, *e.LibraryItemID); err == nil {
						path = p
						originalPathCache[*e.LibraryItemID] = path
					}
				}
				if path != "" {
					originalPath = &path
				}
			}
			out = append(out, toThumbnailEnhancementHistoryResponse(e, hasBackup, originalPath, enhancedPath))
		}
		c.JSON(http.StatusOK, out)
	}
}

// DeleteThumbnailEnhancementHistoryEntry backs the history table's delete
// action — removes one log row, cascading into the item's backup cleanup if
// it was the last row referencing it (see thumbnailenhance.DeleteHistoryEntry).
func DeleteThumbnailEnhancementHistoryEntry(deps thumbnailenhance.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		if err := thumbnailenhance.DeleteHistoryEntry(c.Request.Context(), deps, id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "history entry not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// ClearThumbnailEnhancementHistory backs the AI Enhancement settings tab's
// "Clear All History" button — mirrors ClearHistory's shape exactly.
func ClearThumbnailEnhancementHistory(deps thumbnailenhance.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		n, err := thumbnailenhance.ClearAllHistory(c.Request.Context(), deps)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"deleted": n})
	}
}

// RunThumbnailEnhancementNow backs the "Enhance now" button — mirrors
// CheckSubscriptionNow's shape.
func RunThumbnailEnhancementNow(deps thumbnailenhance.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		enhanced, err := thumbnailenhance.RunOnce(c.Request.Context(), deps)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "enhancing thumbnails failed: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, RunThumbnailEnhancementResponse{Enhanced: enhanced})
	}
}

// ListThumbnailUpscalers backs the Settings tab's "Load models" button —
// tests against whatever URL/username/password are currently typed in the
// form (query params), not necessarily what's saved yet, so a user can
// populate the dropdown before ever clicking Save.
func ListThumbnailUpscalers() gin.HandlerFunc {
	return func(c *gin.Context) {
		url := c.Query("url")
		if url == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "url is required"})
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), thumbnailEnhancementProbeTimeout)
		defer cancel()

		client := thumbnailenhance.NewClient(url, c.Query("username"), c.Query("password"))
		names, err := client.ListUpscalers(ctx)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, ThumbnailUpscalersResponse{Upscalers: names})
	}
}

// GetThumbnailEnhancementStatus backs the AI Enhancement page's status
// badge — probes the saved instance URL/credentials, short-timeout so a
// dead instance doesn't stall the page.
func GetThumbnailEnhancementStatus(deps thumbnailenhance.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		enabled, err := ThumbnailEnhancementEnabled(ctx, deps.SettingsRepo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		url, err := deps.SettingsRepo.Get(ctx, models.SettingThumbnailEnhancementURL)
		if err != nil && !errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if !enabled || url == "" {
			c.JSON(http.StatusOK, ThumbnailEnhancementStatusResponse{Configured: false})
			return
		}

		username, err := deps.SettingsRepo.Get(ctx, models.SettingThumbnailEnhancementUsername)
		if err != nil && !errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		password, err := deps.SettingsRepo.Get(ctx, models.SettingThumbnailEnhancementPassword)
		if err != nil && !errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		probeCtx, cancel := context.WithTimeout(ctx, thumbnailEnhancementProbeTimeout)
		defer cancel()
		client := thumbnailenhance.NewClient(url, username, password)
		if _, err := client.ListUpscalers(probeCtx); err != nil {
			msg := err.Error()
			c.JSON(http.StatusOK, ThumbnailEnhancementStatusResponse{Configured: true, Reachable: false, Error: &msg})
			return
		}
		c.JSON(http.StatusOK, ThumbnailEnhancementStatusResponse{Configured: true, Reachable: true})
	}
}

// ListThumbnailEnhancementEligible backs the "Preview eligible items"
// dialog — every item findEligible would currently pick up, uncapped
// (unlike an actual run, which stops at maxEnhancementsPerSweep).
func ListThumbnailEnhancementEligible(deps thumbnailenhance.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		items, err := thumbnailenhance.ListEligible(c.Request.Context(), deps)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out := make([]ThumbnailEnhancementEligibleItemResponse, 0, len(items))
		for _, item := range items {
			out = append(out, toThumbnailEnhancementEligibleItemResponse(item))
		}
		c.JSON(http.StatusOK, out)
	}
}

// EnhanceThumbnailItemNow backs the eligible-items dialog's per-row
// "Enhance" button — enhances exactly one item, bypassing the batch cap.
func EnhanceThumbnailItemNow(deps thumbnailenhance.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		if err := thumbnailenhance.EnhanceItem(c.Request.Context(), deps, id); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// RevertThumbnailOriginal backs the Compare dialog's "Revert to Original"
// button — restores the pre-enhancement backup and consumes it.
func RevertThumbnailOriginal(deps thumbnailenhance.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		if err := thumbnailenhance.RevertOriginal(c.Request.Context(), deps, id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "no original backup for this item"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// DeleteThumbnailOriginal backs the Compare dialog's "Delete Original"
// button — frees the backup, keeping the current enhanced thumbnail
// permanent.
func DeleteThumbnailOriginal(deps thumbnailenhance.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		if err := thumbnailenhance.DeleteOriginal(c.Request.Context(), deps, id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "no original backup for this item"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

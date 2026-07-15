package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

// anonymizeURL replaces a URL with a short, deterministic hash placeholder —
// same input always produces the same output, so repeated links are still
// visibly recognizable as "the same one" on the History page without
// revealing what they actually are.
func anonymizeURL(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return "hidden-" + hex.EncodeToString(sum[:6])
}

func ListHistory(repo *repository.HistoryRepo, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := repo.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		anonymize, err := HistoryAnonymizeURLs(c.Request.Context(), settingsRepo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		out := make([]HistoryResponse, 0, len(rows))
		for _, h := range rows {
			out = append(out, toHistoryResponse(h, anonymize))
		}
		c.JSON(http.StatusOK, out)
	}
}

// RetryHistoryItem re-queues a download from a history entry's URL, reusing
// the exact original type/quality/format/collection/folder/filename when the
// source download row is still around (same fallback shape as
// RedownloadLibraryItem), falling back to the app's default download type
// otherwise. Only meaningful for entries that didn't end in "completed" —
// retrying a completed one is what Library's "Redownload" is already for.
func RetryHistoryItem(historyRepo *repository.HistoryRepo, downloadsRepo *repository.DownloadsRepo, mgr *queue.DownloadManager, collectionsRepo *repository.CollectionsRepo, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		h, err := historyRepo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "history entry not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		downloadType := "video"
		if def, err := settingsRepo.Get(c.Request.Context(), models.SettingDefaultDownloadType); err == nil && def != "" {
			downloadType = def
		}
		req := CreateDownloadRequest{URL: h.URL, DownloadType: downloadType}
		if h.DownloadID != nil {
			if orig, err := downloadsRepo.Get(c.Request.Context(), *h.DownloadID); err == nil {
				req.CollectionID = orig.CollectionID
				req.Folder = orig.Folder
				req.Filename = orig.Filename
				req.DownloadType = orig.DownloadType
				req.Quality = orig.Quality
				if orig.AudioFormat != nil {
					req.AudioFormat = *orig.AudioFormat
				}
			}
		}

		newID, err := enqueueDownload(c.Request.Context(), mgr, collectionsRepo, settingsRepo, req)
		if err != nil {
			writeEnqueueError(c, err)
			return
		}
		c.JSON(http.StatusCreated, gin.H{"id": newID})
	}
}

// DeleteHistoryItem permanently removes a single history entry — unlike
// DeleteOlderThan's automated retention sweep, this is a direct user action
// with no cutoff involved.
func DeleteHistoryItem(repo *repository.HistoryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		if err := repo.Delete(c.Request.Context(), id); err != nil {
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

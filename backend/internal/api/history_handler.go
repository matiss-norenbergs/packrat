package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

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

// ClearHistory permanently removes every history entry, regardless of age —
// a manual complement to the automated retention sweep (cleanupHistory in
// cmd/server/main.go), for a user who wants to wipe the log right now rather
// than wait for it or lower the retention setting.
func ClearHistory(repo *repository.HistoryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		n, err := repo.DeleteOlderThan(c.Request.Context(), time.Now())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"deleted": n})
	}
}

// BulkDeleteHistory is POST /api/history/bulk-delete: it permanently removes
// the listed history entries in one transaction — unlike DeleteOlderThan's
// automated retention sweep, this is a direct user action with no cutoff
// involved. Ids that do not exist are ignored; "deleted" counts the rows really
// removed.
func BulkDeleteHistory(repo *repository.HistoryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BulkIDsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !checkBulkCount(c, len(req.IDs)) {
			return
		}
		n, err := repo.DeleteByIDs(c.Request.Context(), dedupeKeepOrder(req.IDs))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, BulkDeleteResponse{Deleted: n})
	}
}

// historyRetrier holds what the per-entry retry core needs. The core was the
// body of the former single-entry retry handler.
type historyRetrier struct {
	historyRepo     *repository.HistoryRepo
	downloadsRepo   *repository.DownloadsRepo
	libraryRepo     *repository.LibraryRepo
	mgr             *queue.DownloadManager
	collectionsRepo *repository.CollectionsRepo
	settingsRepo    *repository.SettingsRepo
}

// retry re-queues a download from a history entry's URL, reusing the exact
// original type/quality/format/collection/folder/filename when the source
// download row is still around (same fallback shape as RedownloadLibraryItem),
// falling back to the app's default download type otherwise. Only meaningful
// for entries that didn't end in "completed" — retrying a completed one is what
// Library's "Redownload" is already for. It returns the new download's id.
func (r *historyRetrier) retry(ctx context.Context, id int64) (int64, *opError) {
	h, err := r.historyRepo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return 0, newOpError(http.StatusNotFound, "history entry not found")
		}
		return 0, internalOpError(err)
	}

	downloadType := "video"
	if def, err := r.settingsRepo.Get(ctx, models.SettingDefaultDownloadType); err == nil && def != "" {
		downloadType = def
	}
	req := CreateDownloadRequest{URL: h.URL, DownloadType: downloadType}
	if h.DownloadID != nil {
		if orig, err := r.downloadsRepo.Get(ctx, *h.DownloadID); err == nil {
			req.CollectionID = orig.CollectionID
			req.Folder = orig.Folder
			req.Filename = orig.Filename
			req.DownloadType = orig.DownloadType
			req.Quality = orig.Quality
			if orig.AudioFormat != nil {
				req.AudioFormat = *orig.AudioFormat
			}
			// The original request's metadata overrides, name template and
			// NFO choice carry over too, so the retry produces the same
			// item the first run would have.
			req.Title = orig.OverrideTitle
			req.ArtistID = orig.OverrideArtistID
			req.Year = orig.OverrideYear
			req.SeasonNumber = orig.OverrideSeasonNumber
			req.SequenceNumber = orig.OverrideSequenceNumber
			req.FilenamePrefix = orig.FilenamePrefix
			req.FilenameTemplate = orig.FilenameTemplate
			req.Tags = orig.OverrideTags
			req.GenerateNFO = orig.GenerateNFO

			// Reuse the ghost the failed run left behind instead of
			// creating a second one — only while it still exists, is still
			// a ghost and no other download is filling it in.
			if orig.GhostLibraryItemID != nil {
				if item, err := r.libraryRepo.Get(ctx, *orig.GhostLibraryItemID); err == nil && item.Status == "ghost" {
					if _, active, err := activeDownloadFor(ctx, r.downloadsRepo, item.ID); err == nil && active {
						return 0, newOpError(http.StatusConflict, "a download is already in progress for this item")
					}
					req.GhostLibraryItemID = &item.ID
				}
			}
		}
	}

	newID, err := enqueueDownload(ctx, r.mgr, r.collectionsRepo, r.settingsRepo, req)
	if err != nil {
		status, msg := enqueueErrorStatus(err)
		return 0, newOpError(status, msg)
	}
	return newID, nil
}

// BulkRetryHistory is POST /api/history/bulk-retry: it retries each entry
// independently (enqueueing a download cannot be rolled back, so there is no
// transaction) and answers 200 with one result per id in request order; a
// success carries the new download id. Duplicate ids are dropped.
func BulkRetryHistory(historyRepo *repository.HistoryRepo, downloadsRepo *repository.DownloadsRepo, libraryRepo *repository.LibraryRepo, mgr *queue.DownloadManager, collectionsRepo *repository.CollectionsRepo, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	r := &historyRetrier{historyRepo: historyRepo, downloadsRepo: downloadsRepo, libraryRepo: libraryRepo, mgr: mgr, collectionsRepo: collectionsRepo, settingsRepo: settingsRepo}
	return func(c *gin.Context) {
		var req BulkIDsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !checkBulkCount(c, len(req.IDs)) {
			return
		}
		ids := dedupeKeepOrder(req.IDs)

		ctx, cancel := detachedBulkContext(c)
		defer cancel()

		resp := newBulkResults[int64](len(ids))
		for _, id := range ids {
			newID, e := r.retry(ctx, id)
			if e != nil {
				resp.add(failedResult(id, e))
				continue
			}
			resp.add(BulkItemResult[int64]{ID: id, OK: true, DownloadID: &newID})
		}
		c.JSON(http.StatusOK, resp)
	}
}

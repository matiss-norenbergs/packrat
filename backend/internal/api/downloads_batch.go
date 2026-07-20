package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

type QueuedItemResponse struct {
	ID  int64  `json:"id"`
	URL string `json:"url"`
}

type SkippedItemResponse struct {
	URL           string `json:"url"`
	Title         string `json:"title"`
	LibraryItemID int64  `json:"libraryItemId"`
}

type FailedItemResponse struct {
	URL   string `json:"url"`
	Error string `json:"error"`
}

type EnqueueResultResponse struct {
	Queued  []QueuedItemResponse  `json:"queued"`
	Skipped []SkippedItemResponse `json:"skipped"`
	Failed  []FailedItemResponse  `json:"failed"`
}

// batchEntry pairs a would-be download request with an optional video ID
// used only for duplicate matching — CreateDownloadRequest itself carries no
// video_id (it's populated automatically once a real download completes).
// Playlist expansion knows each entry's video_id up front (from the flat
// playlist listing); plain Bulk Download rows don't, so videoID is "" there
// and duplicate matching falls back to URL-only.
type batchEntry struct {
	req     CreateDownloadRequest
	videoID string
}

// enqueueBatch runs each entry through duplicate detection (when
// skipDuplicates is set) and the existing single-item enqueueDownload
// helper, aggregating the outcome of each. Shared by playlist expansion
// (CreatePlaylistDownload) and the Bulk Download endpoint
// (CreateBatchDownload) — both are "take a list of would-be downloads +a
// skip-duplicates flag, dedupe, enqueue, aggregate results."
func enqueueBatch(ctx context.Context, mgr *queue.DownloadManager, collectionsRepo *repository.CollectionsRepo, settingsRepo *repository.SettingsRepo, libraryRepo *repository.LibraryRepo, historyRepo *repository.HistoryRepo, entries []batchEntry, skipDuplicates bool) EnqueueResultResponse {
	result := EnqueueResultResponse{
		Queued:  []QueuedItemResponse{},
		Skipped: []SkippedItemResponse{},
		Failed:  []FailedItemResponse{},
	}

	// Batched into one query instead of one FindDuplicate call per entry —
	// significant for a large playlist/bulk-download submission.
	var dupsByIndex map[int]*models.LibraryItem
	if skipDuplicates {
		queries := make([]repository.DuplicateQuery, len(entries))
		for i, entry := range entries {
			queries[i] = repository.DuplicateQuery{URL: entry.req.URL, VideoID: entry.videoID}
		}
		dupsByIndex, _ = libraryRepo.FindDuplicates(ctx, queries) // best-effort — a lookup failure just skips dedup, same as FindDuplicate's err handling did per-entry before
	}

	for i, entry := range entries {
		if skipDuplicates {
			if dup, ok := dupsByIndex[i]; ok {
				result.Skipped = append(result.Skipped, SkippedItemResponse{
					URL:           entry.req.URL,
					Title:         dup.Title,
					LibraryItemID: dup.ID,
				})
				msg := fmt.Sprintf("Already in library (added %s)", dup.DownloadedAt.Format(time.RFC3339))
				_, _ = historyRepo.Create(ctx, nil, entry.req.URL, "duplicate", &msg)
				continue
			}
		}

		id, err := enqueueDownload(ctx, mgr, collectionsRepo, settingsRepo, entry.req)
		if err != nil {
			result.Failed = append(result.Failed, FailedItemResponse{URL: entry.req.URL, Error: err.Error()})
			continue
		}
		result.Queued = append(result.Queued, QueuedItemResponse{ID: id, URL: entry.req.URL})
	}

	return result
}

// CreateBatchDownloadRequest queues many independent downloads in one call —
// used by the Bulk Download dialog, replacing what used to be N separate
// POST /api/downloads calls with one request and one aggregated result.
type CreateBatchDownloadRequest struct {
	Items          []CreateDownloadRequest `json:"items" binding:"required,min=1,max=200,dive"`
	SkipDuplicates bool                    `json:"skipDuplicates"`
}

func CreateBatchDownload(mgr *queue.DownloadManager, collectionsRepo *repository.CollectionsRepo, settingsRepo *repository.SettingsRepo, libraryRepo *repository.LibraryRepo, historyRepo *repository.HistoryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateBatchDownloadRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		entries := make([]batchEntry, len(req.Items))
		for i, item := range req.Items {
			entries[i] = batchEntry{req: item}
		}

		result := enqueueBatch(c.Request.Context(), mgr, collectionsRepo, settingsRepo, libraryRepo, historyRepo, entries, req.SkipDuplicates)
		c.JSON(http.StatusCreated, result)
	}
}

// CreatePlaylistDownloadRequest submits a playlist URL plus a mode
// describing which entries to queue. Entries are resolved server-side (via
// a fresh flat-playlist fetch) rather than trusting a client-supplied list —
// the client only ever names a URL and a mode.
type CreatePlaylistDownloadRequest struct {
	URL            string `json:"url" binding:"required,url"`
	CollectionID   *int64 `json:"collectionId"`
	DownloadType   string `json:"downloadType" binding:"required,oneof=video audio"`
	Quality        string `json:"quality"`
	AudioFormat    string `json:"audioFormat"`
	PlaylistMode   string `json:"playlistMode" binding:"required,oneof=current entire range first_n"`
	PlaylistStart  *int   `json:"playlistStart"` // 1-based, inclusive; required for "range"
	PlaylistEnd    *int   `json:"playlistEnd"`   // 1-based, inclusive; required for "range"
	PlaylistLimit  *int   `json:"playlistLimit"` // required for "first_n"
	SkipDuplicates bool   `json:"skipDuplicates"`
}

// filterPlaylistEntries applies mode/start/end/limit to a flat playlist
// entry list. Pure and side-effect-free so it's easy to unit test directly.
func filterPlaylistEntries(entries []downloader.PlaylistEntry, mode string, start, end, limit *int) ([]downloader.PlaylistEntry, error) {
	switch mode {
	case "entire":
		return entries, nil
	case "range":
		if start == nil || end == nil {
			return nil, fmt.Errorf("playlistStart and playlistEnd are required for range mode")
		}
		if *start < 1 || *end < *start || *end > len(entries) {
			return nil, fmt.Errorf("invalid range %d-%d for a %d-entry playlist", *start, *end, len(entries))
		}
		return entries[*start-1 : *end], nil
	case "first_n":
		if limit == nil || *limit < 1 {
			return nil, fmt.Errorf("playlistLimit must be a positive number for first_n mode")
		}
		n := *limit
		if n > len(entries) {
			n = len(entries)
		}
		return entries[:n], nil
	default:
		return nil, fmt.Errorf("unknown playlist mode %q", mode)
	}
}

func CreatePlaylistDownload(mgr *queue.DownloadManager, collectionsRepo *repository.CollectionsRepo, settingsRepo *repository.SettingsRepo, libraryRepo *repository.LibraryRepo, historyRepo *repository.HistoryRepo, ytdlp *downloader.YtDlpService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreatePlaylistDownloadRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !isHTTPURL(req.URL) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "url must be an http or https URL"})
			return
		}

		// "current" never needs a playlist listing — it's exactly today's
		// single-video behavior (--no-playlist, applied by the untouched
		// BuildArgs), submitted through the URL unchanged.
		if req.PlaylistMode == "current" {
			entries := []batchEntry{{req: CreateDownloadRequest{
				URL: req.URL, CollectionID: req.CollectionID, DownloadType: req.DownloadType,
				Quality: req.Quality, AudioFormat: req.AudioFormat,
			}}}
			result := enqueueBatch(c.Request.Context(), mgr, collectionsRepo, settingsRepo, libraryRepo, historyRepo, entries, req.SkipDuplicates)
			c.JSON(http.StatusCreated, result)
			return
		}

		meta, err := ytdlp.FetchMetadata(c.Request.Context(), req.URL)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}

		filtered, err := filterPlaylistEntries(meta.Entries, req.PlaylistMode, req.PlaylistStart, req.PlaylistEnd, req.PlaylistLimit)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		entries := make([]batchEntry, len(filtered))
		for i, pe := range filtered {
			position := i + 1
			entries[i] = batchEntry{
				req: CreateDownloadRequest{
					URL: pe.URL, CollectionID: req.CollectionID, DownloadType: req.DownloadType,
					Quality: req.Quality, AudioFormat: req.AudioFormat, SequenceNumber: &position,
				},
				videoID: pe.ID,
			}
		}

		result := enqueueBatch(c.Request.Context(), mgr, collectionsRepo, settingsRepo, libraryRepo, historyRepo, entries, req.SkipDuplicates)
		c.JSON(http.StatusCreated, result)
	}
}

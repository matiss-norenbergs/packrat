package api

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/framematch"
	"packrat/backend/internal/repository"
)

// StartFrameMatch kicks off a background scan of the item's video for the
// frame that best matches either its source-URL thumbnail or its current
// one (see StartFrameMatchRequest.Mode), returning a job ID to poll via
// GetFrameMatchStatus — matching routinely takes tens of seconds to a
// couple of minutes, far too long to hold this request open.
func StartFrameMatch(mediaRoot string, libraryRepo *repository.LibraryRepo, ytdlp *downloader.YtDlpService, ffprobePath string, jobs *framematch.JobStore, queueRepo *repository.FrameMatchQueueRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		var req StartFrameMatchRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		alreadyQueued, err := queueRepo.ExistsForLibraryItem(ctx, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if alreadyQueued {
			c.JSON(http.StatusConflict, gin.H{"error": "this item already has a frame match pending or awaiting review — check the Frame Matching page"})
			return
		}

		item, err := libraryRepo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no media file"})
			return
		}
		videoAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))

		referenceJPEG, err := framematch.ResolveReferenceImage(ctx, ytdlp, mediaRoot, *item, req.Mode)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}

		jobID := jobs.Start(ytdlp, ffprobePath, videoAbs, referenceJPEG)
		c.JSON(http.StatusOK, StartFrameMatchResponse{JobID: jobID})
	}
}

// GetFrameMatchStatus polls a job started by StartFrameMatch.
func GetFrameMatchStatus(jobs *framematch.JobStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		status, ok := jobs.Get(c.Param("jobId"))
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "match job not found"})
			return
		}

		resp := FrameMatchStatusResponse{State: status.State}
		switch status.State {
		case "done":
			ts := status.Result.TimestampSeconds
			score := status.Result.Score
			img := status.Result.ImageBase64
			ref := status.Result.ReferenceImageBase64
			resp.TimestampSeconds = &ts
			resp.Score = &score
			resp.ImageBase64 = &img
			resp.ReferenceImageBase64 = &ref
		case "error":
			errMsg := status.ErrorMsg
			resp.Error = &errMsg
		}
		c.JSON(http.StatusOK, resp)
	}
}

// BulkStartFrameMatch backs the Library toolbar's "Match from URL/Current
// Thumbnail…" bulk actions — enqueues every eligible selected item onto
// frame_match_queue (picked up by framematch.RunQueue's background worker)
// and reports how many were queued vs. skipped. An item is skipped, not
// errored, when it's ineligible for the requested mode (no source URL for
// "url", no current thumbnail for "current") or has no video file (a ghost
// item) — a bulk action shouldn't fail the whole batch over one item that
// was never going to work, same tolerance convention as bulk redownload. An
// item already sitting in the queue (any state) is skipped too and counted
// separately, so re-selecting an already-queued item doesn't waste a
// redundant scan on it.
func BulkStartFrameMatch(libraryRepo *repository.LibraryRepo, queueRepo *repository.FrameMatchQueueRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		var req BulkFrameMatchRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		alreadyQueued, err := queueRepo.LibraryItemIDsInQueue(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		var resp BulkFrameMatchResponse
		for _, id := range req.ItemIds {
			if alreadyQueued[id] {
				resp.AlreadyQueued++
				continue
			}
			item, err := libraryRepo.Get(ctx, id)
			if err != nil {
				resp.Skipped++
				continue
			}
			if item.Path == "" {
				resp.Skipped++
				continue
			}
			if req.Mode == "url" && item.OriginalURL == nil {
				resp.Skipped++
				continue
			}
			if req.Mode == "current" && item.Thumbnail == nil {
				resp.Skipped++
				continue
			}
			if _, err := queueRepo.Create(ctx, item.ID, item.Title, req.Mode); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			// Guards against the same item appearing twice in one request
			// (e.g. selected directly and also pulled in via a collection)
			// from enqueuing a duplicate row against itself.
			alreadyQueued[id] = true
			resp.Queued++
		}
		c.JSON(http.StatusAccepted, resp)
	}
}

// ListFrameMatchQueue backs the "Frame Matching" page — every row currently
// in the working queue (queued/running/done/error), oldest first.
func ListFrameMatchQueue(queueRepo *repository.FrameMatchQueueRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		items, err := queueRepo.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out := make([]FrameMatchQueueItemResponse, 0, len(items))
		for _, item := range items {
			out = append(out, FrameMatchQueueItemResponse{
				ID:                 item.ID,
				LibraryItemID:      item.LibraryItemID,
				ItemTitle:          item.ItemTitle,
				Mode:               item.Mode,
				State:              item.State,
				TimestampSeconds:   item.TimestampSeconds,
				Score:              item.Score,
				FoundFramePath:     item.FoundFramePath,
				ReferenceImagePath: item.ReferenceImagePath,
				Error:              item.ErrorMsg,
			})
		}
		c.JSON(http.StatusOK, out)
	}
}

// AcceptFrameMatchQueueItem backs the Frame Matching page's "Use this
// frame" action — writes the queue row's already-found frame as the item's
// thumbnail (reusing writeThumbnailAndRespond, the same commit path
// SetLibraryThumbnail uses) and, once that succeeds, removes the row and
// its snapshot image files: this is a working queue, not a permanent
// history, so a resolved row has nothing left to keep.
func AcceptFrameMatchQueueItem(mediaRoot, imagesRoot, ffmpegPath string, queueRepo *repository.FrameMatchQueueRepo, libraryRepo *repository.LibraryRepo, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, originalsRepo *repository.ThumbnailEnhancementOriginalsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		row, err := queueRepo.Get(ctx, id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "queue item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if row.State != "done" || row.FoundFramePath == nil {
			c.JSON(http.StatusConflict, gin.H{"error": "match is not ready to use"})
			return
		}

		item, err := libraryRepo.Get(ctx, row.LibraryItemID)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no media file"})
			return
		}

		foundAbs := filepath.Join(imagesRoot, filepath.FromSlash(*row.FoundFramePath))
		data, err := os.ReadFile(foundAbs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "reading found frame: " + err.Error()})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		thumbAbs := thumbnailAbsPathFor(mediaAbs)
		if err := os.WriteFile(thumbAbs, data, 0o644); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		writeThumbnailAndRespond(c, libraryRepo, collectionsRepo, tagsRepo, originalsRepo, row.LibraryItemID, mediaRoot, imagesRoot, ffmpegPath, thumbAbs)
		if c.Writer.Status() != http.StatusOK {
			// writeThumbnailAndRespond already sent its own error response —
			// leave the queue row in place so the user can retry Accept.
			return
		}

		removeFrameMatchQueueFiles(imagesRoot, id)
		if err := queueRepo.Delete(ctx, id); err != nil && !errors.Is(err, repository.ErrNotFound) {
			log.Printf("frame match queue item %d: deleting resolved row failed: %v", id, err)
		}
	}
}

// DiscardFrameMatchQueueItem backs the Frame Matching page's "Discard"
// action on a done row and "Dismiss" on an error row (and also lets a
// still-queued/running row be removed from the queue outright) — removes
// the row and any snapshot image files without touching the item's
// thumbnail. A match still "running" when discarded is a soft cancel: the
// in-flight goroutine's eventual SetDone/SetError call just becomes a
// harmless no-op against an id that no longer exists.
func DiscardFrameMatchQueueItem(imagesRoot string, queueRepo *repository.FrameMatchQueueRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		if err := queueRepo.Delete(c.Request.Context(), id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "queue item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		removeFrameMatchQueueFiles(imagesRoot, id)
		c.Status(http.StatusNoContent)
	}
}

// removeFrameMatchQueueFiles deletes a resolved queue row's snapshot image
// directory — best-effort, since the row itself (already deleted by the
// caller) is the source of truth, not these files.
func removeFrameMatchQueueFiles(imagesRoot string, queueID int64) {
	dir := filepath.Join(imagesRoot, "frame-match", fmt.Sprint(queueID))
	if err := os.RemoveAll(dir); err != nil {
		log.Printf("frame match queue item %d: deleting snapshot images failed: %v", queueID, err)
	}
}

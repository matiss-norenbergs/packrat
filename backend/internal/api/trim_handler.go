package api

import (
	"errors"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/importer"
	"packrat/backend/internal/itemlock"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/repository"
)

// GetLibraryItemTrimFrames decodes every frame in [start, end) and returns
// them for the trim dialog's "pick the exact frame" picker — a precision
// alternative to the browser <video> element's own (not reliably
// frame-accurate) seeking. Read-only, nothing persisted.
func GetLibraryItemTrimFrames(repo *repository.LibraryRepo, mediaRoot string, ytdlp *downloader.YtDlpService, ffprobePath string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		start, err := strconv.ParseFloat(c.Query("start"), 64)
		if err != nil || start < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start"})
			return
		}
		end, err := strconv.ParseFloat(c.Query("end"), 64)
		if err != nil || end <= start {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end"})
			return
		}

		item, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			writeServerError(c, err)
			return
		}

		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no media file"})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		res, err := ytdlp.ExtractFrameThumbnails(c.Request.Context(), ffprobePath, mediaAbs, start, end)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "extracting frames: " + err.Error()})
			return
		}

		resp := make([]TrimFrameResponse, len(res.Frames))
		for i, f := range res.Frames {
			resp[i] = TrimFrameResponse{TimestampSeconds: f.TimestampSeconds, ImageBase64: f.ImageBase64}
		}
		c.JSON(http.StatusOK, gin.H{"frames": resp, "truncated": res.Truncated, "totalFrames": res.TotalFrames})
	}
}

// PreviewLibraryItemTrim generates a trimmed preview of the item's media
// file — written into mediaRoot's shared TrimTmpDir, original untouched —
// and returns its MediaRoot-relative path plus the resulting duration/size
// so the client can play it back via the existing /media-files static
// route.
func PreviewLibraryItemTrim(repo *repository.LibraryRepo, mediaRoot string, ytdlp *downloader.YtDlpService, ffprobePath string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		var req TrimPreviewRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.TrimStartSeconds == nil && req.TrimEndSeconds == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "at least one of trimStartSeconds/trimEndSeconds is required"})
			return
		}

		item, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			writeServerError(c, err)
			return
		}

		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no media file"})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		previewAbs, durationSeconds, fileSizeBytes, err := ytdlp.BuildTrimPreview(c.Request.Context(), ffprobePath, mediaAbs, mediaRoot, id, req.TrimStartSeconds, req.TrimEndSeconds)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "generating trim preview: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, TrimPreviewResponse{
			PreviewPath:     toRelSlash(mediaRoot, previewAbs),
			DurationSeconds: durationSeconds,
			FileSizeBytes:   fileSizeBytes,
		})
	}
}

// resolveTrimPreviewPath validates a client-supplied preview path before
// any accept/discard file operation touches disk: it must resolve under
// mediaRoot (pathsafe's usual traversal defense), sit directly inside
// mediaRoot's shared TrimTmpDir (not some arbitrary collection folder), and
// match the ".trim-preview-" naming convention BuildTrimPreview generates, and
// carry itemID in that name (the preview must have been cut from this very
// item, not another item's) — defense in depth against accepting/deleting an
// unrelated file even if the path otherwise resolves safely under the root.
func resolveTrimPreviewPath(mediaRoot, previewPath string, itemID int64) (string, error) {
	resolved, err := pathsafe.ResolveUnderRoot(mediaRoot, previewPath)
	if err != nil {
		return "", err
	}

	if filepath.Dir(resolved) != downloader.TrimTmpDir(mediaRoot) {
		return "", errors.New("preview path is not inside the trim tmp directory")
	}
	if !strings.Contains(filepath.Base(resolved), ".trim-preview-") {
		return "", errors.New("preview path does not look like a trim preview file")
	}
	if owner, ok := downloader.TrimPreviewItemID(filepath.Base(resolved)); !ok || owner != itemID {
		return "", errors.New("preview path belongs to a different item")
	}
	return resolved, nil
}

// AcceptLibraryItemTrim overwrites the item's media file with the
// already-generated preview and updates the stored duration/size to match.
func AcceptLibraryItemTrim(repo *repository.LibraryRepo, mediaRoot, ffprobePath string, ytdlp *downloader.YtDlpService, responder *ItemResponder, locks *itemlock.Locks) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		var req TrimActionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// The accept renames the preview over the media file; a metadata remux
		// finishing afterwards would put the untrimmed content back.
		if !locks.TryLock(id) {
			writeItemBusy(c)
			return
		}
		defer locks.Unlock(id)

		item, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			writeServerError(c, err)
			return
		}

		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no media file"})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		previewAbs, err := resolveTrimPreviewPath(mediaRoot, req.PreviewPath, id)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := ytdlp.AcceptTrim(previewAbs, mediaAbs); err != nil {
			writeServerError(c, err)
			return
		}

		probe := importer.Probe(c.Request.Context(), ffprobePath, mediaAbs)
		// A failed probe leaves DurationSeconds nil: store NULL ("unknown"), not 0.
		if err := repo.UpdateDurationAndSize(c.Request.Context(), id, probe.DurationSeconds, probe.SizeBytes); err != nil {
			writeServerError(c, err)
			return
		}

		updated, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			writeServerError(c, err)
			return
		}

		resp, err := responder.Response(c.Request.Context(), *updated)
		if err != nil {
			writeServerError(c, err)
			return
		}
		c.JSON(http.StatusOK, resp)
	}
}

// DiscardLibraryItemTrim deletes a generated preview file without touching
// the original — used both by an explicit "Discard" and by the dialog
// closing without an Accept. Doesn't need to look up the library item: the
// preview path is validated against mediaRoot's shared TrimTmpDir and the
// item id embedded in the preview's name (resolveTrimPreviewPath), so one
// item's dialog cannot delete another item's preview.
func DiscardLibraryItemTrim(mediaRoot string, ytdlp *downloader.YtDlpService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		var req TrimActionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		resolved, err := resolveTrimPreviewPath(mediaRoot, req.PreviewPath, id)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := ytdlp.DiscardTrimPreview(resolved); err != nil {
			writeServerError(c, err)
			return
		}

		c.Status(http.StatusNoContent)
	}
}

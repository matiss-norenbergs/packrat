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
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no media file"})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		frames, err := ytdlp.ExtractFrameRange(c.Request.Context(), ffprobePath, mediaAbs, start, end)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "extracting frames: " + err.Error()})
			return
		}

		resp := make([]TrimFrameResponse, len(frames))
		for i, f := range frames {
			resp[i] = TrimFrameResponse{TimestampSeconds: f.TimestampSeconds, ImageBase64: f.ImageBase64}
		}
		c.JSON(http.StatusOK, gin.H{"frames": resp})
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
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if item.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "item has no media file"})
			return
		}

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		previewAbs, durationSeconds, fileSizeBytes, err := ytdlp.BuildTrimPreview(c.Request.Context(), ffprobePath, mediaAbs, mediaRoot, req.TrimStartSeconds, req.TrimEndSeconds)
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
// match the ".trim-preview-" naming convention BuildTrimPreview generates —
// defense in depth against accepting/deleting an unrelated file even if the
// path otherwise resolves safely under the root.
func resolveTrimPreviewPath(mediaRoot, previewPath string) (string, error) {
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
	return resolved, nil
}

// AcceptLibraryItemTrim overwrites the item's media file with the
// already-generated preview and updates the stored duration/size to match.
func AcceptLibraryItemTrim(repo *repository.LibraryRepo, mediaRoot, ffprobePath string, ytdlp *downloader.YtDlpService, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
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

		item, err := repo.Get(c.Request.Context(), id)
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

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		previewAbs, err := resolveTrimPreviewPath(mediaRoot, req.PreviewPath)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := ytdlp.AcceptTrim(previewAbs, mediaAbs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		probe := importer.Probe(c.Request.Context(), ffprobePath, mediaAbs)
		durationSeconds := 0
		if probe.DurationSeconds != nil {
			durationSeconds = *probe.DurationSeconds
		}
		if err := repo.UpdateDurationAndSize(c.Request.Context(), id, durationSeconds, probe.SizeBytes); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		updated, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		privacyEnabled, err := PrivacyEnabled(c.Request.Context(), settingsRepo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		var blurred bool
		if privacyEnabled && updated.CollectionID != nil {
			blurred, err = collectionsRepo.IsPrivate(c.Request.Context(), *updated.CollectionID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		tags, err := tagsRepo.TagsForLibraryItem(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if !blurred && privacyEnabled {
			blurred, err = tagsRepo.HasPrivateTag(c.Request.Context(), tags)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		c.JSON(http.StatusOK, toLibraryItemResponse(*updated, blurred, tags, mediaRoot))
	}
}

// DiscardLibraryItemTrim deletes a generated preview file without touching
// the original — used both by an explicit "Discard" and by the dialog
// closing without an Accept. Doesn't need to look up the library item: the
// preview path is validated purely against mediaRoot's shared TrimTmpDir
// (resolveTrimPreviewPath), independent of which item it came from — the
// :id in the route just keeps the URL shape consistent with preview/accept.
func DiscardLibraryItemTrim(mediaRoot string, ytdlp *downloader.YtDlpService) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, err := strconv.ParseInt(c.Param("id"), 10, 64); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		var req TrimActionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		resolved, err := resolveTrimPreviewPath(mediaRoot, req.PreviewPath)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := ytdlp.DiscardTrimPreview(resolved); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.Status(http.StatusNoContent)
	}
}

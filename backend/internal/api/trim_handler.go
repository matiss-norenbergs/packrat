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

// PreviewLibraryItemTrim generates a trimmed preview of the item's media
// file — a new sibling file, original untouched — and returns its
// MediaRoot-relative path plus the resulting duration/size so the client
// can play it back via the existing /media-files static route.
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

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		previewAbs, durationSeconds, fileSizeBytes, err := ytdlp.BuildTrimPreview(c.Request.Context(), ffprobePath, mediaAbs, req.TrimStartSeconds, req.TrimEndSeconds)
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
// mediaRoot (pathsafe's usual traversal defense), sit in the same
// directory as mediaAbs (the item's own media file), and match the
// ".trim-preview-" naming convention BuildTrimPreview generates — defense
// in depth against accepting/deleting an unrelated file even if the path
// otherwise resolves safely under the root.
func resolveTrimPreviewPath(mediaRoot, mediaAbs, previewPath string) (string, error) {
	resolved, err := pathsafe.ResolveUnderRoot(mediaRoot, previewPath)
	if err != nil {
		return "", err
	}

	if filepath.Dir(resolved) != filepath.Dir(mediaAbs) {
		return "", errors.New("preview path is not alongside the item's media file")
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

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		previewAbs, err := resolveTrimPreviewPath(mediaRoot, mediaAbs, req.PreviewPath)
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
// closing without an Accept.
func DiscardLibraryItemTrim(repo *repository.LibraryRepo, mediaRoot string, ytdlp *downloader.YtDlpService) gin.HandlerFunc {
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

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		resolved, err := resolveTrimPreviewPath(mediaRoot, mediaAbs, req.PreviewPath)
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

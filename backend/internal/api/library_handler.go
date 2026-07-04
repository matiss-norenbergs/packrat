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
	"packrat/backend/internal/fsutil"
	"packrat/backend/internal/models"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

func ListLibrary(repo *repository.LibraryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := repo.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out := make([]LibraryItemResponse, 0, len(rows))
		for _, item := range rows {
			out = append(out, toLibraryItemResponse(item))
		}
		c.JSON(http.StatusOK, out)
	}
}

// DeleteLibraryItem removes a library row and, when ?deleteFiles=true is
// passed, best-effort removes the media file and thumbnail from disk too —
// a missing file is logged, not treated as a request failure, since the
// end state (file gone) is the same either way.
func DeleteLibraryItem(repo *repository.LibraryRepo, mediaRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		deleteFiles := c.Query("deleteFiles") == "true"

		item, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if deleteFiles {
			mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
			if err := os.Remove(mediaAbs); err != nil && !os.IsNotExist(err) {
				log.Printf("library: failed to delete media file %s: %v", mediaAbs, err)
			}
			if item.Thumbnail != nil {
				thumbAbs := filepath.Join(mediaRoot, filepath.FromSlash(*item.Thumbnail))
				if err := os.Remove(thumbAbs); err != nil && !os.IsNotExist(err) {
					log.Printf("library: failed to delete thumbnail %s: %v", thumbAbs, err)
				}
			}
		}

		if err := repo.Delete(c.Request.Context(), id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// RenameLibraryItem updates the display title (DB only) and/or the actual
// filename (renames the media file and its thumbnail on disk, then updates
// the DB — see fsutil.RenamePair for the best-effort atomicity) and/or the
// display-only metadata fields (uploader, description, duration,
// resolution). Fields omitted from the request are left untouched — the
// current value is merged in before writing, so a form that only sends the
// fields it changed can never accidentally blank out the others.
func UpdateLibraryItem(repo *repository.LibraryRepo, mediaRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		var req UpdateLibraryItemRequest
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

		if req.Title != nil {
			if err := repo.UpdateTitle(c.Request.Context(), id, *req.Title); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		if req.Filename != nil {
			newBase := fsutil.SanitizeFilename(*req.Filename)
			if newBase == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid filename"})
				return
			}

			mediaExt := filepath.Ext(item.Filename)
			oldMediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
			dir := filepath.Dir(oldMediaAbs)
			newMediaAbs := filepath.Join(dir, newBase+mediaExt)

			var oldThumbAbs, newThumbAbs string
			if item.Thumbnail != nil {
				thumbExt := filepath.Ext(*item.Thumbnail)
				oldThumbAbs = filepath.Join(mediaRoot, filepath.FromSlash(*item.Thumbnail))
				newThumbAbs = filepath.Join(dir, newBase+thumbExt)
			}

			if err := fsutil.RenamePair(oldMediaAbs, newMediaAbs, oldThumbAbs, newThumbAbs); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}

			var newThumbRelPtr *string
			if item.Thumbnail != nil {
				s := toRelSlash(mediaRoot, newThumbAbs)
				newThumbRelPtr = &s
			}
			if err := repo.UpdateFilename(c.Request.Context(), id, newBase+mediaExt, toRelSlash(mediaRoot, newMediaAbs), newThumbRelPtr); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		if req.Uploader != nil || req.Description != nil || req.Duration != nil || req.Resolution != nil {
			uploader, description, duration, resolution := req.Uploader, req.Description, req.Duration, req.Resolution
			if uploader == nil {
				uploader = item.Uploader
			}
			if description == nil {
				description = item.Description
			}
			if duration == nil {
				duration = item.Duration
			}
			if resolution == nil {
				resolution = item.Resolution
			}
			// title=nil relies on UpdateMetadata's COALESCE(?, title) so this
			// call never touches title — that's handled by UpdateTitle above.
			if err := repo.UpdateMetadata(c.Request.Context(), id, nil, uploader, duration, resolution, description); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		c.Status(http.StatusNoContent)
	}
}

// MoveLibraryItem relocates the media file and thumbnail to a new
// collection/folder, reusing the same effective-root resolution and
// path-safety validation as creating a download in the first place.
func MoveLibraryItem(repo *repository.LibraryRepo, mgr *queue.DownloadManager, mediaRoot string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		var req MoveLibraryItemRequest
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

		effectiveRoot, err := mgr.ResolveEffectiveRoot(c.Request.Context(), req.CollectionID)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "collection not found"})
				return
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid collection root: " + err.Error()})
			return
		}
		destDir, err := pathsafe.ResolveUnderRoot(effectiveRoot, req.Folder)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder: " + err.Error()})
			return
		}
		if err := fsutil.EnsureDir(destDir); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		oldMediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))
		newMediaAbs := filepath.Join(destDir, item.Filename)

		var oldThumbAbs, newThumbAbs string
		if item.Thumbnail != nil {
			oldThumbAbs = filepath.Join(mediaRoot, filepath.FromSlash(*item.Thumbnail))
			newThumbAbs = filepath.Join(destDir, filepath.Base(*item.Thumbnail))
		}

		if err := fsutil.RenamePair(oldMediaAbs, newMediaAbs, oldThumbAbs, newThumbAbs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		var newThumbRelPtr *string
		if item.Thumbnail != nil {
			s := toRelSlash(mediaRoot, newThumbAbs)
			newThumbRelPtr = &s
		}
		if err := repo.UpdateLocation(c.Request.Context(), id, req.CollectionID, req.Folder, item.Filename, toRelSlash(mediaRoot, newMediaAbs), newThumbRelPtr); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.Status(http.StatusNoContent)
	}
}

// RefreshLibraryItemMetadata re-fetches yt-dlp metadata for the item's
// original URL and updates the display fields — it never touches the
// media file or thumbnail already on disk.
func RefreshLibraryItemMetadata(repo *repository.LibraryRepo, ytdlp *downloader.YtDlpService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
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

		meta, err := ytdlp.FetchMetadata(c.Request.Context(), item.OriginalURL)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "fetching metadata: " + err.Error()})
			return
		}

		duration := int(meta.Duration)
		var resolution *string
		if meta.Width > 0 && meta.Height > 0 {
			r := fmt.Sprintf("%dx%d", meta.Width, meta.Height)
			resolution = &r
		}
		title, uploader, description := meta.Title, meta.Uploader, meta.Description

		if err := repo.UpdateMetadata(c.Request.Context(), id, &title, &uploader, &duration, resolution, &description); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		updated, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, toLibraryItemResponse(*updated))
	}
}

// RedownloadLibraryItem re-queues a download from the item's original URL,
// reusing the exact original type/quality/format/filename when the source
// download row is still around, falling back to sensible defaults if not.
func RedownloadLibraryItem(libraryRepo *repository.LibraryRepo, downloadsRepo *repository.DownloadsRepo, mgr *queue.DownloadManager, collectionsRepo *repository.CollectionsRepo, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		item, err := libraryRepo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "library item not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		downloadType := "video"
		if def, err := settingsRepo.Get(c.Request.Context(), models.SettingDefaultDownloadType); err == nil && def != "" {
			downloadType = def
		}
		req := CreateDownloadRequest{
			URL:          item.OriginalURL,
			CollectionID: item.CollectionID,
			Folder:       item.Folder,
			DownloadType: downloadType,
		}
		if item.DownloadID != nil {
			if orig, err := downloadsRepo.Get(c.Request.Context(), *item.DownloadID); err == nil {
				req.DownloadType = orig.DownloadType
				req.Quality = orig.Quality
				req.Filename = orig.Filename
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

func toRelSlash(root, abs string) string {
	if rel, err := filepath.Rel(root, abs); err == nil {
		return filepath.ToSlash(rel)
	}
	return filepath.ToSlash(abs)
}

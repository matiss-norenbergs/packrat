package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/fsutil"
	"packrat/backend/internal/models"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

func ListLibrary(repo *repository.LibraryRepo, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := repo.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		cols, err := collectionsRepo.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		privacy := effectivePrivacyMap(cols)

		ids := make([]int64, len(rows))
		for i, item := range rows {
			ids[i] = item.ID
		}
		tagsByID, err := tagsRepo.TagsByLibraryIDs(c.Request.Context(), ids)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		out := make([]LibraryItemResponse, 0, len(rows))
		for _, item := range rows {
			blurred := item.CollectionID != nil && privacy[*item.CollectionID]
			out = append(out, toLibraryItemResponse(item, blurred, tagsByID[item.ID]))
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
// resolution, artist, year). Fields omitted from the request are left
// untouched — the current value is merged in before writing, so a form
// that only sends the fields it changed can never accidentally blank out
// the others. If title/artist/year changed, the actual file's own
// container metadata is best-effort updated to match (see EmbedMetadata) —
// this runs in the background after the response is sent, since it remuxes
// the whole file via ffmpeg and can take several seconds for a real video;
// a failure there is logged but never fails the request, since the app's
// own DB state is the source of truth for what Packrat displays.
func UpdateLibraryItem(repo *repository.LibraryRepo, mediaRoot string, ytdlp *downloader.YtDlpService, tagsRepo *repository.TagsRepo) gin.HandlerFunc {
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

		mediaAbs := filepath.Join(mediaRoot, filepath.FromSlash(item.Path))

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
			mediaAbs = newMediaAbs
		}

		if req.Uploader != nil || req.Description != nil || req.Duration != nil || req.Resolution != nil || req.Artist != nil || req.Year != nil || req.SequenceNumber != nil {
			uploader, description, duration, resolution, artist, year, sequenceNumber := req.Uploader, req.Description, req.Duration, req.Resolution, req.Artist, req.Year, req.SequenceNumber
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
			if artist == nil {
				artist = item.Artist
			}
			if year == nil {
				year = item.ReleaseYear
			}
			if sequenceNumber == nil {
				sequenceNumber = item.SequenceNumber
			}
			// title=nil relies on UpdateMetadata's COALESCE(?, title) so this
			// call never touches title — that's handled by UpdateTitle above.
			if err := repo.UpdateMetadata(c.Request.Context(), id, nil, uploader, duration, resolution, description, artist, year, sequenceNumber); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		if req.Title != nil || req.Artist != nil || req.Year != nil || req.SequenceNumber != nil {
			title := item.Title
			if req.Title != nil {
				title = *req.Title
			}
			artist := item.Artist
			if req.Artist != nil {
				artist = req.Artist
			}
			year := item.ReleaseYear
			if req.Year != nil {
				year = req.Year
			}
			sequenceNumber := item.SequenceNumber
			if req.SequenceNumber != nil {
				sequenceNumber = req.SequenceNumber
			}
			// Backgrounded: c.Request.Context() would be cancelled as soon as
			// the handler returns, so this uses context.Background() instead —
			// EmbedMetadata applies its own internal timeout regardless.
			go func(path, title string, artist *string, year, sequenceNumber *int) {
				if err := ytdlp.EmbedMetadata(context.Background(), path, title, artist, year, sequenceNumber); err != nil {
					log.Printf("library: embedding metadata into %s failed: %v", path, err)
				}
			}(mediaAbs, title, artist, year, sequenceNumber)
		}

		if req.OriginalURL != nil {
			trimmed := strings.TrimSpace(*req.OriginalURL)
			var urlPtr *string
			if trimmed != "" {
				urlPtr = &trimmed
			}
			if err := repo.UpdateOriginalURL(c.Request.Context(), id, urlPtr); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		if req.Tags != nil {
			tagIDs, err := tagsRepo.GetOrCreateByNames(c.Request.Context(), *req.Tags)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if err := tagsRepo.SetForLibraryItem(c.Request.Context(), id, tagIDs); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		if req.GenerateNFO != nil {
			if err := repo.UpdateGenerateNFO(c.Request.Context(), id, *req.GenerateNFO); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		// Keep an opted-in item's .nfo sidecar in sync whenever something it
		// reflects changes — including the toggle itself just being turned on,
		// so the file appears immediately rather than waiting for the next
		// unrelated edit. Failure here doesn't fail the request: the metadata
		// save itself already succeeded.
		nfoRelevant := req.Title != nil || req.Description != nil || req.Year != nil || req.SequenceNumber != nil || req.Tags != nil ||
			(req.GenerateNFO != nil && *req.GenerateNFO)
		if nfoRelevant {
			if updated, err := repo.Get(c.Request.Context(), id); err == nil && updated.GenerateNFO {
				if err := writeNFO(c.Request.Context(), mediaRoot, tagsRepo, updated); err != nil {
					log.Printf("library: writing nfo for %d failed: %v", id, err)
				}
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
func RefreshLibraryItemMetadata(repo *repository.LibraryRepo, ytdlp *downloader.YtDlpService, collectionsRepo *repository.CollectionsRepo, tagsRepo *repository.TagsRepo, mediaRoot string) gin.HandlerFunc {
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

		if item.OriginalURL == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no source URL set for this item"})
			return
		}

		meta, err := ytdlp.FetchMetadata(c.Request.Context(), *item.OriginalURL)
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

		// artist/year/sequenceNumber are manual-only fields (yt-dlp doesn't
		// reliably expose them) — pass the item's existing values through so
		// this refresh never clobbers them.
		if err := repo.UpdateMetadata(c.Request.Context(), id, &title, &uploader, &duration, resolution, &description, item.Artist, item.ReleaseYear, item.SequenceNumber); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		updated, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		var blurred bool
		if updated.CollectionID != nil {
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

		if updated.GenerateNFO {
			if err := writeNFO(c.Request.Context(), mediaRoot, tagsRepo, updated); err != nil {
				log.Printf("library: writing nfo for %d failed: %v", id, err)
			}
		}

		c.JSON(http.StatusOK, toLibraryItemResponse(*updated, blurred, tags))
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

		if item.OriginalURL == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no source URL set for this item"})
			return
		}

		downloadType := "video"
		if def, err := settingsRepo.Get(c.Request.Context(), models.SettingDefaultDownloadType); err == nil && def != "" {
			downloadType = def
		}
		req := CreateDownloadRequest{
			URL:          *item.OriginalURL,
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

package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/downloader"
	"packrat/backend/internal/models"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

func CreateDownload(mgr *queue.DownloadManager, collectionsRepo *repository.CollectionsRepo, settingsRepo *repository.SettingsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateDownloadRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		id, err := enqueueDownload(c.Request.Context(), mgr, collectionsRepo, settingsRepo, req)
		if err != nil {
			writeEnqueueError(c, err)
			return
		}

		c.JSON(http.StatusCreated, gin.H{"id": id})
	}
}

// PreviewDownloadMetadata fetches yt-dlp metadata for a URL without queuing anything, for the
// New Download dialog's pre-submit preview card. A fetch failure (bad URL, unsupported site,
// network error) is reported as 422 — the frontend treats this as non-fatal and never blocks
// submission on it. For a non-playlist URL, also looks up whether it's already in the library
// (by original URL or video ID) so the dialog can offer Skip/Replace/Download Anyway.
func PreviewDownloadMetadata(ytdlp *downloader.YtDlpService, libraryRepo *repository.LibraryRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req PreviewDownloadRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !isHTTPURL(req.URL) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "url must be an http or https URL"})
			return
		}

		meta, err := ytdlp.FetchMetadata(c.Request.Context(), req.URL)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}

		var dup *models.LibraryItem
		if !meta.IsPlaylist() {
			dup, err = libraryRepo.FindDuplicate(c.Request.Context(), req.URL, meta.ID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		c.JSON(http.StatusOK, toPreviewDownloadResponse(meta, dup))
	}
}

// enqueueDownload applies collection/app-wide defaults, validates the
// destination path, and queues the download. Shared by CreateDownload and
// RedownloadLibraryItem so both go through identical validation.
func enqueueDownload(ctx context.Context, mgr *queue.DownloadManager, collectionsRepo *repository.CollectionsRepo, settingsRepo *repository.SettingsRepo, req CreateDownloadRequest) (int64, error) {
	if !isHTTPURL(req.URL) {
		return 0, invalidURLError{}
	}
	if req.CollectionID != nil {
		collection, err := collectionsRepo.Get(ctx, *req.CollectionID)
		if err != nil {
			return 0, err
		}
		if req.Quality == "" {
			req.Quality = collection.DefaultQuality
		}
		// Only fall back to the collection's template when the caller left
		// both the literal filename and their own template empty — an
		// explicit choice at request time always wins, same as Quality above.
		if req.Filename == "" && (req.FilenameTemplate == nil || *req.FilenameTemplate == "") && collection.FilenameTemplate != "" {
			req.FilenameTemplate = &collection.FilenameTemplate
		}
	}
	if req.Quality == "" {
		if def, err := settingsRepo.Get(ctx, models.SettingDefaultQuality); err == nil && def != "" {
			req.Quality = def
		} else {
			req.Quality = "best"
		}
	}
	if req.DownloadType == "audio" && req.AudioFormat == "" {
		req.AudioFormat = "mp3"
	}

	// Reject path traversal (and unknown collections) up front, before ever
	// queuing the job — the queue worker re-validates this too, but failing
	// fast here gives the caller an immediate error instead of a later
	// asynchronous "failed" status.
	effectiveRoot, err := mgr.ResolveEffectiveRoot(ctx, req.CollectionID)
	if err != nil {
		return 0, err
	}
	if _, err := pathsafe.ResolveUnderRoot(effectiveRoot, req.Folder); err != nil {
		return 0, invalidFolderError{err}
	}

	d := models.Download{
		URL:                    req.URL,
		CollectionID:           req.CollectionID,
		Folder:                 req.Folder,
		Filename:               req.Filename,
		DownloadType:           req.DownloadType,
		Quality:                req.Quality,
		OverrideTitle:          req.Title,
		OverrideArtistID:       req.ArtistID,
		OverrideYear:           req.Year,
		OverrideSeasonNumber:   req.SeasonNumber,
		OverrideSequenceNumber: req.SequenceNumber,
		FilenamePrefix:         req.FilenamePrefix,
		FilenameTemplate:       req.FilenameTemplate,
		OverrideTags:           req.Tags,
		GenerateNFO:            req.GenerateNFO,
	}
	if req.AudioFormat != "" {
		d.AudioFormat = &req.AudioFormat
	}

	return mgr.Enqueue(ctx, d)
}

// invalidFolderError distinguishes a bad "folder" value from a bad/missing
// collection, both of which enqueueDownload can return as plain errors —
// writeEnqueueError uses this to pick the right message.
type invalidFolderError struct{ err error }

func (e invalidFolderError) Error() string { return e.err.Error() }
func (e invalidFolderError) Unwrap() error { return e.err }

// invalidURLError marks enqueueDownload's URL-scheme rejection so
// writeEnqueueError can report it as a 400 instead of a 500.
type invalidURLError struct{}

func (e invalidURLError) Error() string { return "url must be an http or https URL" }

// writeEnqueueError maps an enqueueDownload error to an HTTP response.
func writeEnqueueError(c *gin.Context, err error) {
	var folderErr invalidFolderError
	if errors.As(err, &folderErr) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder: " + folderErr.Error()})
		return
	}
	var urlErr invalidURLError
	if errors.As(err, &urlErr) {
		c.JSON(http.StatusBadRequest, gin.H{"error": urlErr.Error()})
		return
	}
	if errors.Is(err, repository.ErrNotFound) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "collection not found"})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
}

func ListDownloads(mgr *queue.DownloadManager, repo *repository.DownloadsRepo, collectionsRepo *repository.CollectionsRepo) gin.HandlerFunc {
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

		live := mgr.ProgressSnapshot()
		out := make([]DownloadResponse, 0, len(rows))
		for _, d := range rows {
			blurred := d.CollectionID != nil && privacy[*d.CollectionID]
			out = append(out, toDownloadResponse(d, live[d.ID], blurred))
		}
		c.JSON(http.StatusOK, out)
	}
}

func CancelDownload(mgr *queue.DownloadManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		if err := mgr.Cancel(c.Request.Context(), id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "download not found"})
				return
			}
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// DeleteDownload removes a download's history row — distinct from
// CancelDownload, which stops an in-flight job. Only terminal-status rows
// (completed/failed/cancelled/interrupted) can be deleted; an active one
// must be cancelled first. Safe with respect to the library table: see
// DownloadsRepo.Delete.
func DeleteDownload(repo *repository.DownloadsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		d, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "download not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		for _, active := range models.ActiveStatuses() {
			if d.Status == active {
				c.JSON(http.StatusConflict, gin.H{"error": "cancel this download before deleting it"})
				return
			}
		}

		if err := repo.Delete(c.Request.Context(), id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "download not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// ClearDownloadLog permanently removes every terminal (non-active) download
// log entry, regardless of age — a manual complement to the automated
// retention sweep (cleanupDownloadLog in cmd/server/main.go). Never touches
// an active download: DeleteOlderThan itself excludes those, so this can't
// be used to short-circuit DeleteDownload's cancel-first guard.
func ClearDownloadLog(repo *repository.DownloadsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		n, err := repo.DeleteOlderThan(c.Request.Context(), time.Now())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"deleted": n})
	}
}

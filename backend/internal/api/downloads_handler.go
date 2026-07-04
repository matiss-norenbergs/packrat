package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

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

// enqueueDownload applies collection/app-wide defaults, validates the
// destination path, and queues the download. Shared by CreateDownload and
// RedownloadLibraryItem so both go through identical validation.
func enqueueDownload(ctx context.Context, mgr *queue.DownloadManager, collectionsRepo *repository.CollectionsRepo, settingsRepo *repository.SettingsRepo, req CreateDownloadRequest) (int64, error) {
	if req.CollectionID != nil {
		collection, err := collectionsRepo.Get(ctx, *req.CollectionID)
		if err != nil {
			return 0, err
		}
		if req.Quality == "" {
			req.Quality = collection.DefaultQuality
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
		URL:          req.URL,
		CollectionID: req.CollectionID,
		Folder:       req.Folder,
		Filename:     req.Filename,
		DownloadType: req.DownloadType,
		Quality:      req.Quality,
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

// writeEnqueueError maps an enqueueDownload error to an HTTP response.
func writeEnqueueError(c *gin.Context, err error) {
	var folderErr invalidFolderError
	if errors.As(err, &folderErr) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder: " + folderErr.Error()})
		return
	}
	if errors.Is(err, repository.ErrNotFound) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "collection not found"})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
}

func ListDownloads(mgr *queue.DownloadManager, repo *repository.DownloadsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := repo.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		live := mgr.ProgressSnapshot()
		out := make([]DownloadResponse, 0, len(rows))
		for _, d := range rows {
			out = append(out, toDownloadResponse(d, live[d.ID]))
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

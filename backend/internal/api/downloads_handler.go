package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/pathsafe"
	"packrat/backend/internal/queue"
	"packrat/backend/internal/repository"
)

func CreateDownload(mgr *queue.DownloadManager, collectionsRepo *repository.CollectionsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateDownloadRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if req.CollectionID != nil {
			collection, err := collectionsRepo.Get(c.Request.Context(), *req.CollectionID)
			if err != nil {
				if errors.Is(err, repository.ErrNotFound) {
					c.JSON(http.StatusBadRequest, gin.H{"error": "collection not found"})
					return
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			if req.Quality == "" {
				req.Quality = collection.DefaultQuality
			}
		}
		if req.Quality == "" {
			req.Quality = "best"
		}
		if req.DownloadType == "audio" && req.AudioFormat == "" {
			req.AudioFormat = "mp3"
		}

		// Reject path traversal (and unknown collections) up front, before
		// ever queuing the job — the queue worker re-validates this too,
		// but failing fast here gives the caller an immediate 400 instead
		// of a later asynchronous "failed" status.
		effectiveRoot, err := mgr.ResolveEffectiveRoot(c.Request.Context(), req.CollectionID)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "collection not found"})
				return
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid collection root: " + err.Error()})
			return
		}
		if _, err := pathsafe.ResolveUnderRoot(effectiveRoot, req.Folder); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder: " + err.Error()})
			return
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

		id, err := mgr.Enqueue(c.Request.Context(), d)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"id": id})
	}
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

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

func ListCollections(repo *repository.CollectionsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := repo.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out := make([]CollectionResponse, 0, len(rows))
		for _, col := range rows {
			out = append(out, toCollectionResponse(col))
		}
		c.JSON(http.StatusOK, out)
	}
}

func CreateCollection(repo *repository.CollectionsRepo, mgr *queue.DownloadManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateCollectionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.DefaultQuality == "" {
			req.DefaultQuality = "best"
		}
		if req.DefaultDownloadType == "" {
			req.DefaultDownloadType = "video"
		}

		if _, err := pathsafe.ResolveUnderRoot(mgr.MediaRoot(), req.RootPath); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid root path: " + err.Error()})
			return
		}

		col := models.Collection{
			Name:                req.Name,
			RootPath:            req.RootPath,
			DefaultQuality:      req.DefaultQuality,
			DefaultDownloadType: req.DefaultDownloadType,
		}
		id, err := repo.Create(c.Request.Context(), &col)
		if err != nil {
			if errors.Is(err, repository.ErrDuplicateName) {
				c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"id": id})
	}
}

func UpdateCollection(repo *repository.CollectionsRepo, mgr *queue.DownloadManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		var req UpdateCollectionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.DefaultQuality == "" {
			req.DefaultQuality = "best"
		}
		if req.DefaultDownloadType == "" {
			req.DefaultDownloadType = "video"
		}

		if _, err := pathsafe.ResolveUnderRoot(mgr.MediaRoot(), req.RootPath); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid root path: " + err.Error()})
			return
		}

		col := models.Collection{
			Name:                req.Name,
			RootPath:            req.RootPath,
			DefaultQuality:      req.DefaultQuality,
			DefaultDownloadType: req.DefaultDownloadType,
		}
		if err := repo.Update(c.Request.Context(), id, &col); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
				return
			}
			if errors.Is(err, repository.ErrDuplicateName) {
				c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.Status(http.StatusNoContent)
	}
}

func DeleteCollection(repo *repository.CollectionsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		if err := repo.Delete(c.Request.Context(), id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

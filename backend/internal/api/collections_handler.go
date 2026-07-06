package api

import (
	"context"
	"errors"
	"net/http"
	"path"
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
		itemCounts, err := repo.ItemCounts(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		paths := collectionPaths(rows)
		out := make([]CollectionResponse, 0, len(rows))
		for _, col := range rows {
			out = append(out, toCollectionResponse(col, paths[col.ID], itemCounts[col.ID]))
		}
		c.JSON(http.StatusOK, out)
	}
}

// prospectiveCollectionPath computes the full relative path a collection
// would occupy if its own segment is ownSegment and its parent is parentID
// (nil for a root collection) — used to path-safety-validate a segment
// before it's actually persisted.
func prospectiveCollectionPath(ctx context.Context, repo *repository.CollectionsRepo, parentID *int64, ownSegment string) (string, error) {
	if parentID == nil {
		return ownSegment, nil
	}
	parentPath, err := repo.ResolvePath(ctx, *parentID)
	if err != nil {
		return "", err
	}
	return path.Join(parentPath, ownSegment), nil
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

		prospectivePath, err := prospectiveCollectionPath(c.Request.Context(), repo, req.ParentID, req.RootPath)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "parent collection not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if _, err := pathsafe.ResolveUnderRoot(mgr.MediaRoot(), prospectivePath); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid root path: " + err.Error()})
			return
		}

		col := models.Collection{
			Name:                req.Name,
			ParentID:            req.ParentID,
			RootPath:            req.RootPath,
			DefaultQuality:      req.DefaultQuality,
			DefaultDownloadType: req.DefaultDownloadType,
			IsPrivate:           req.IsPrivate,
			JellyfinLibrary:     req.JellyfinLibraryID,
		}
		id, err := repo.Create(c.Request.Context(), &col)
		if err != nil {
			if errors.Is(err, repository.ErrDuplicateName) {
				c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
				return
			}
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "parent collection not found"})
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

		existing, err := repo.Get(c.Request.Context(), id)
		if err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// parent_id is creation-time only — renaming the segment must still be
		// re-validated against the *existing* parent so it can't escape the
		// media root.
		prospectivePath, err := prospectiveCollectionPath(c.Request.Context(), repo, existing.ParentID, req.RootPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if _, err := pathsafe.ResolveUnderRoot(mgr.MediaRoot(), prospectivePath); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid root path: " + err.Error()})
			return
		}

		col := models.Collection{
			Name:                req.Name,
			RootPath:            req.RootPath,
			DefaultQuality:      req.DefaultQuality,
			DefaultDownloadType: req.DefaultDownloadType,
			IsPrivate:           req.IsPrivate,
			JellyfinLibrary:     req.JellyfinLibraryID,
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
			if errors.Is(err, repository.ErrHasChildren) {
				c.JSON(http.StatusConflict, gin.H{"error": "collection has sub-collections — move or delete them first"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

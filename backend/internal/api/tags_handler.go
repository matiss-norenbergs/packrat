package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/repository"
)

func ListTags(repo *repository.TagsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := repo.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out := make([]TagResponse, 0, len(rows))
		for _, t := range rows {
			out = append(out, toTagResponse(t))
		}
		c.JSON(http.StatusOK, out)
	}
}

func CreateTag(repo *repository.TagsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateTagRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		tag, err := repo.Create(c.Request.Context(), req.Name)
		if err != nil {
			if errors.Is(err, repository.ErrTagNameInUse) {
				c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"id": tag.ID})
	}
}

func UpdateTag(repo *repository.TagsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		var req UpdateTagRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := repo.Rename(c.Request.Context(), id, req.Name); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "tag not found"})
				return
			}
			if errors.Is(err, repository.ErrTagNameInUse) {
				c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func DeleteTag(repo *repository.TagsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}

		if err := repo.Delete(c.Request.Context(), id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "tag not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// BulkDeleteTags deletes every listed tag, best-effort — an id that's
// already gone (ErrNotFound) is skipped rather than failing the batch,
// since deleting a tag never fails for being "in use" (library_tags cascades).
func BulkDeleteTags(repo *repository.TagsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BulkDeleteRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		var resp BulkDeleteResponse
		for _, id := range req.IDs {
			if err := repo.Delete(c.Request.Context(), id); err != nil {
				if errors.Is(err, repository.ErrNotFound) {
					continue
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			resp.Deleted++
		}
		c.JSON(http.StatusOK, resp)
	}
}

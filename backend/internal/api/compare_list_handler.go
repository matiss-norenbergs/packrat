package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/repository"
)

// ListCompareList returns every item currently on the compare list, oldest
// added first — the same tag/privacy resolution ListLibrary does, so a
// private item shows blurred here exactly like everywhere else.
func ListCompareList(repo *repository.CompareListRepo, responder *ItemResponder) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := repo.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		out, err := responder.Responses(c.Request.Context(), rows)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, out)
	}
}

// AddToCompareList adds every listed item id — already-listed ids are a
// silent no-op (see CompareListRepo.Add).
func AddToCompareList(repo *repository.CompareListRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req AddToCompareListRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := repo.Add(c.Request.Context(), req.ItemIDs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func RemoveFromCompareList(repo *repository.CompareListRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		if err := repo.Remove(c.Request.Context(), id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "not in compare list"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func ClearCompareList(repo *repository.CompareListRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := repo.Clear(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

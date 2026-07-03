package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

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

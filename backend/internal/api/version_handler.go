package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/version"
)

// GetVersion reports Packrat's own release version — not sensitive, so it
// lives in the public route group alongside /health rather than requiring a
// session, the same way an unauthenticated login page might still want to
// show what it's running.
func GetVersion() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"version": version.Version})
	}
}

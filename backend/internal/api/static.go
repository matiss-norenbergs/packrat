package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// serveSPA serves the built frontend from dir, falling back to index.html
// for any path that isn't an existing file so client-side routing (React
// Router) works on a hard refresh of a deep link like /library.
func serveSPA(dir string) gin.HandlerFunc {
	return func(c *gin.Context) {
		reqPath := filepath.Clean(c.Request.URL.Path)
		fullPath := filepath.Join(dir, reqPath)

		if info, err := os.Stat(fullPath); err == nil && !info.IsDir() {
			c.File(fullPath)
			return
		}
		if strings.HasPrefix(c.Request.URL.Path, "/downloads") && c.Request.Method != http.MethodGet {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.File(filepath.Join(dir, "index.html"))
	}
}

package api

import (
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
)

// serveSPA serves the built frontend from dir, falling back to index.html
// for any path that isn't an existing file so client-side routing (React
// Router) works on a hard refresh of a deep link like /library. Only ever
// reached for paths that don't match a registered route — all real API
// routes live under /api, so there's no risk of shadowing an SPA route of
// the same name.
func serveSPA(dir string) gin.HandlerFunc {
	return func(c *gin.Context) {
		reqPath := filepath.Clean(c.Request.URL.Path)
		fullPath := filepath.Join(dir, reqPath)

		if info, err := os.Stat(fullPath); err == nil && !info.IsDir() {
			c.File(fullPath)
			return
		}
		c.File(filepath.Join(dir, "index.html"))
	}
}

package api

import (
	"os"
	"path/filepath"
	"strings"

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
			switch {
			case strings.HasPrefix(filepath.ToSlash(reqPath), "/assets/"):
				// Vite content-hashes everything under /assets, so a given
				// URL never changes content. (Only set for files that exist:
				// a stale hashed URL falls through to index.html below and
				// must not be cached as immutable.)
				c.Header("Cache-Control", "public, max-age=31536000, immutable")
			case filepath.Base(fullPath) == "index.html":
				c.Header("Cache-Control", "no-cache")
			}
			c.File(fullPath)
			return
		}
		// SPA fallback: always revalidate so a new deploy's asset hashes are
		// picked up immediately.
		c.Header("Cache-Control", "no-cache")
		c.File(filepath.Join(dir, "index.html"))
	}
}

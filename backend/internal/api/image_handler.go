package api

import (
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/imageproc"
	"packrat/backend/internal/pathsafe"
)

// GetResizedImage serves GET /api/image — a stored image resized to a
// whitelisted width (and optional whitelisted max height) as WebP, cached
// under CACHE_ROOT. The base files it reads are overwritten in place, so the
// response revalidates (no-cache + ETag + Last-Modified) rather than being
// treated as immutable.
func GetResizedImage(mediaRoot, imagesRoot string, resizer *imageproc.Resizer) gin.HandlerFunc {
	return func(c *gin.Context) {
		var root string
		switch c.Query("root") {
		case "media":
			root = mediaRoot
		case "images":
			root = imagesRoot
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "root must be media or images"})
			return
		}

		rel := c.Query("path")
		if rel == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "path is required"})
			return
		}
		switch strings.ToLower(filepath.Ext(rel)) {
		case ".jpg", ".jpeg", ".png", ".webp":
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported image type"})
			return
		}

		width, err := strconv.Atoi(c.Query("w"))
		if err != nil || !imageproc.IsAllowedResizeWidth(width) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "w must be one of 320, 480, 720, 1080, 1280, 1920"})
			return
		}
		height := 0
		if raw := c.Query("h"); raw != "" {
			height, err = strconv.Atoi(raw)
			if err != nil || !imageproc.IsAllowedResizeHeight(height) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "h must be one of 180, 270, 405, 720, 1080"})
				return
			}
		}

		abs, err := pathsafe.ResolveUnderRoot(root, rel)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path"})
			return
		}
		info, err := os.Stat(abs)
		if err != nil || !info.Mode().IsRegular() {
			c.JSON(http.StatusNotFound, gin.H{"error": "image not found"})
			return
		}

		req := imageproc.ResizeRequest{
			Root:   c.Query("root"),
			Path:   rel,
			SrcAbs: abs,
			Mtime:  info.ModTime(),
			Size:   info.Size(),
			Width:  width,
			Height: height,
		}
		cached, err := resizer.Get(c.Request.Context(), req)
		if err != nil {
			if errors.Is(err, c.Request.Context().Err()) && c.Request.Context().Err() != nil {
				return
			}
			log.Printf("image resize %s (w=%d h=%d) failed: %v", rel, width, height, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "resize failed"})
			return
		}

		f, err := os.Open(cached)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "resize failed"})
			return
		}
		defer f.Close()

		c.Header("Cache-Control", "no-cache")
		c.Header("ETag", `"`+req.Key()+`"`)
		c.Header("Content-Type", "image/webp")
		// ServeContent handles If-None-Match / If-Modified-Since -> 304 and
		// emits Last-Modified from the source mtime.
		http.ServeContent(c.Writer, c.Request, "", info.ModTime(), f)
	}
}

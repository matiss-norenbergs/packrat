package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// CORS lets the listed origins call the API cross-origin. Requests from any other origin —
// including the web UI itself, which is same-origin and never needs CORS — pass through untouched,
// with no CORS headers added. There is deliberately no wildcard and no Allow-Credentials: the
// desktop client authenticates with an explicit bearer token, not ambient cookies.
func CORS(allowedOrigins []string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[strings.TrimRight(o, "/")] = struct{}{}
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin == "" || len(allowed) == 0 {
			c.Next()
			return
		}
		// Responses differ by Origin, so caches must key on it.
		c.Writer.Header().Add("Vary", "Origin")
		if _, ok := allowed[origin]; !ok {
			c.Next()
			return
		}
		h := c.Writer.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		if c.Request.Method == http.MethodOptions && c.GetHeader("Access-Control-Request-Method") != "" {
			h.Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-CSRF-Token, X-Client, Range")
			h.Set("Access-Control-Max-Age", "600")
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		h.Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Disposition, Accept-Ranges")
		c.Next()
	}
}

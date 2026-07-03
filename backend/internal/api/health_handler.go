package api

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
)

func Health(conn *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := conn.PingContext(c.Request.Context()); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unhealthy", "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	}
}

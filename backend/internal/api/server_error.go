package api

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/db"
)

// databaseBusyMessage is what a client sees when a write could not get the
// database's write lock within db.BusyTimeout. It deliberately says nothing
// about SQLite.
const databaseBusyMessage = "The database is busy. Try again in a moment."

// serverErrorStatus maps an unexpected (non-validation) failure to the status
// and message a handler answers with: 503 for a busy database, 500 with the
// error text otherwise.
func serverErrorStatus(err error) (int, string) {
	if db.IsBusy(err) {
		return http.StatusServiceUnavailable, databaseBusyMessage
	}
	return http.StatusInternalServerError, err.Error()
}

// writeServerError answers an unexpected failure. Use it instead of
// c.JSON(http.StatusInternalServerError, ...) for any error that can come from
// the database, so a busy database is a retryable 503 (with Retry-After) and
// is logged, not a 500 with a raw SQLite message.
func writeServerError(c *gin.Context, err error) {
	writeServerErrorPrefixed(c, "", err)
}

// writeServerErrorPrefixed is writeServerError with prefix put in front of the
// message of a plain 500 (the busy 503 message stays as it is).
func writeServerErrorPrefixed(c *gin.Context, prefix string, err error) {
	status, msg := serverErrorStatus(err)
	if status == http.StatusServiceUnavailable {
		log.Printf("api: %s %s: %v", c.Request.Method, c.Request.URL.Path, err)
		c.Header("Retry-After", "2")
	} else {
		msg = prefix + msg
	}
	c.JSON(status, gin.H{"error": msg})
}

package api

import (
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
)

// maxBackupImportBodyBytes bounds the body of the endpoints that take an
// uploaded backup file (settings / library / full import and preview). It is
// deliberately NOT the global maxRequestBodyBytes: a backup travels as base64
// inside JSON, and a big library does not fit in 50 MB.
//
// Why 128 MB. A synthetic 20,000-item full backup (300 collections, 800 tags,
// 400 artists, 4 tags per item, long titles and URLs: 736 bytes of bundle JSON
// per item) is a 18.7 MiB request body; 128 MiB is ~6.8x that, about 137,000
// items, and 2.5x the old global cap. It is not larger because decoding is
// memory-hungry: the request string, the parsed envelope, the base64-decoded
// bytes, the decrypted bytes and the unmarshalled bundle are alive together —
// the peak heap measured ~7.3x the body (18.7 MiB -> ~135 MiB above baseline),
// before the import itself — so a body at the limit costs roughly 0.9 GiB of
// live heap (more with Go's GC slack). Raising it further risks OOM-killing
// the container for what is a rare, admin-only upload.
const maxBackupImportBodyBytes = 128 << 20

// rawBodyKey holds the request body as received, before limitRequestBody wraps
// it with the global cap, so a route can apply its own limit instead.
const rawBodyKey = "packrat.rawBody"

// allowLargeBody is route middleware that replaces the global body limit with
// limit for that route only. A declared Content-Length over the limit is
// refused with 413 right away, without reading anything; an undeclared one
// (chunked) is cut off while reading, which the handler reports as 413 too
// (see bindBackupImport).
func allowLargeBody(limit int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > limit {
			writeBodyTooLarge(c, limit)
			c.Abort()
			return
		}
		body := c.Request.Body
		if raw, ok := c.Get(rawBodyKey); ok {
			body = raw.(io.ReadCloser)
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, body, limit)
		c.Next()
	}
}

func writeBodyTooLarge(c *gin.Context, limit int64) {
	c.JSON(http.StatusRequestEntityTooLarge, gin.H{
		"error": fmt.Sprintf("The backup file is too large (the limit is %d MB).", limit>>20),
	})
}

// bindBackupImport binds the JSON body of a backup import/preview request. On
// failure it writes the response itself — 413 when the body went over the
// route's limit, 400 for anything else — and reports false.
func bindBackupImport(c *gin.Context, req *BackupImportRequest) bool {
	err := c.ShouldBindJSON(req)
	if err == nil {
		return true
	}
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		writeBodyTooLarge(c, tooBig.Limit)
		return false
	}
	c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	return false
}

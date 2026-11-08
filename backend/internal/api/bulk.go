package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Bulk endpoint conventions (see docs/architecture.md, "Bulk endpoints"):
//
//   - POST .../bulk-<action>, JSON body, at most maxBulkItems entries, an
//     empty list is a 400.
//   - Destructive set operations are all-or-nothing: one transaction, every id
//     validated first, a blocked id answers 409 {error, blockedIds} and nothing
//     changes. Ids that do not exist are ignored.
//   - Operations that touch the disk or schedule work a transaction cannot undo
//     report per-item results instead (BulkItemResult, always HTTP 200 for a
//     valid request).
//   - Files are removed only after the commit, best effort.

// maxBulkItems is the most ids / items one bulk request may carry.
const maxBulkItems = 1000

// bulkBatchTimeout bounds a per-item-results batch that runs detached from the
// request context (see detachedBulkContext).
const bulkBatchTimeout = 2 * time.Minute

// bulkCountError returns the 400 message for a bulk list of n entries, or ""
// when n is acceptable.
func bulkCountError(n int) string {
	if n == 0 {
		return "the list must not be empty"
	}
	if n > maxBulkItems {
		return fmt.Sprintf("too many entries: at most %d per request", maxBulkItems)
	}
	return ""
}

// checkBulkCount writes the 400 for an empty or oversized list and reports
// whether the request may proceed.
func checkBulkCount(c *gin.Context, n int) bool {
	if msg := bulkCountError(n); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return false
	}
	return true
}

// dedupeKeepOrder drops repeated values, keeping the first occurrence of each.
func dedupeKeepOrder[T comparable](in []T) []T {
	seen := make(map[T]struct{}, len(in))
	out := make([]T, 0, len(in))
	for _, v := range in {
		if _, dup := seen[v]; dup {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

// detachedBulkContext returns the context a per-item-results batch runs on.
// Such a batch renames files, schedules remuxes and enqueues downloads, none of
// which a database transaction can undo, so the loop must not be cut off half
// way when the client disconnects (a closed tab would leave the batch silently
// unreported). It keeps the request's values, drops its cancellation, and is
// bounded by bulkBatchTimeout instead.
func detachedBulkContext(c *gin.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(c.Request.Context()), bulkBatchTimeout)
}

// opError is a per-item failure: the HTTP status the single-item handler used
// to answer plus its message.
type opError struct {
	Status int
	Msg    string
}

func (e *opError) Error() string { return e.Msg }

func newOpError(status int, msg string) *opError { return &opError{Status: status, Msg: msg} }

// internalOpError wraps an unexpected error as a 500.
func internalOpError(err error) *opError {
	return &opError{Status: http.StatusInternalServerError, Msg: err.Error()}
}

// BulkItemResult is one entry of a per-item-results response. K is the id type
// of the request (int64 for library items and history entries, string for
// subscription source ids).
type BulkItemResult[K comparable] struct {
	ID            K      `json:"id"`
	OK            bool   `json:"ok"`
	Status        int    `json:"status,omitempty"`
	Error         string `json:"error,omitempty"`
	DownloadID    *int64 `json:"downloadId,omitempty"`
	LibraryItemID *int64 `json:"libraryItemId,omitempty"`
}

// BulkResultsResponse is the body of every per-item-results endpoint.
type BulkResultsResponse[K comparable] struct {
	Results   []BulkItemResult[K] `json:"results"`
	Succeeded int                 `json:"succeeded"`
	Failed    int                 `json:"failed"`
}

// add appends a result and keeps the counters in step.
func (r *BulkResultsResponse[K]) add(res BulkItemResult[K]) {
	if res.OK {
		r.Succeeded++
	} else {
		r.Failed++
	}
	r.Results = append(r.Results, res)
}

func newBulkResults[K comparable](capacity int) *BulkResultsResponse[K] {
	return &BulkResultsResponse[K]{Results: make([]BulkItemResult[K], 0, capacity)}
}

// failed builds the failure result for one item from its opError.
func failedResult[K comparable](id K, e *opError) BulkItemResult[K] {
	return BulkItemResult[K]{ID: id, Status: e.Status, Error: e.Msg}
}

// writeBlocked answers an all-or-nothing request that contains blocked ids:
// 409 with the offending ids, nothing changed.
func writeBlocked(c *gin.Context, msg string, blockedIDs []int64) {
	if blockedIDs == nil {
		blockedIDs = []int64{}
	}
	c.JSON(http.StatusConflict, gin.H{"error": msg, "blockedIds": blockedIDs})
}

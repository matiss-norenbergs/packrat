package api

import (
	"log"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/ratelimit"
	"packrat/backend/internal/repository"
)

// AuthDeps bundles what the credential-taking handlers (login, change password, 2FA) share.
type AuthDeps struct {
	Users   *repository.UsersRepo
	Limiter *ratelimit.Limiter
}

// rateLimited aborts with 429 (+ Retry-After and a JSON body) when ip is blocked for any of the
// given steps, and reports whether it did. Blocks are logged by address only.
func (d *AuthDeps) rateLimited(c *gin.Context, kinds ...ratelimit.Kind) bool {
	ip := c.ClientIP()
	var wait time.Duration
	var blockedKind ratelimit.Kind
	for _, k := range kinds {
		if w := d.Limiter.Check(ip, k); w > wait {
			wait, blockedKind = w, k
		}
	}
	if wait <= 0 {
		return false
	}
	secs := int(math.Ceil(wait.Seconds()))
	log.Printf("auth rate limit: blocked %s step=%s retryAfter=%ds", ip, blockedKind, secs)
	c.Header("Retry-After", strconv.Itoa(secs))
	c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
		"error":             "too many attempts, try again later",
		"retryAfterSeconds": secs,
	})
	return true
}

// fail counts a failed attempt against the caller's address and the global budget for kind.
func (d *AuthDeps) fail(c *gin.Context, kind ratelimit.Kind) {
	d.Limiter.Fail(c.ClientIP(), kind)
}

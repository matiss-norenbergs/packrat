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
	"packrat/backend/internal/twofactor"
)

// failureRetention is how long failed attempts stay visible to the "since your last login" notice.
const failureRetention = 30 * 24 * time.Hour

// AuthDeps bundles what the credential-taking handlers (login, change password, 2FA) share.
type AuthDeps struct {
	Users      *repository.UsersRepo
	Limiter    *ratelimit.Limiter
	Crypto     *twofactor.Crypto
	Challenges *twofactor.Challenges
	// Now is the clock (injectable for tests); nil means time.Now.
	Now func() time.Time
}

// NewAuthDeps wires the limiter and challenge store to one clock.
func NewAuthDeps(users *repository.UsersRepo, crypto *twofactor.Crypto, now func() time.Time) *AuthDeps {
	if now == nil {
		now = time.Now
	}
	return &AuthDeps{
		Users:      users,
		Limiter:    ratelimit.New(now),
		Crypto:     crypto,
		Challenges: twofactor.NewChallenges(now),
		Now:        now,
	}
}

func (d *AuthDeps) now() time.Time {
	if d.Now != nil {
		return d.Now()
	}
	return time.Now()
}

// rateLimited aborts with 429 (+ Retry-After and a JSON body) when the caller is blocked for any
// of the given steps, and reports whether it did. Blocks are logged by address only.
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

// fail counts a failed attempt against the caller's address and the global budget for kind, and
// logs it (time, address, label — never what was typed) for the security notice.
func (d *AuthDeps) fail(c *gin.Context, kind ratelimit.Kind, label string) {
	ip := c.ClientIP()
	d.Limiter.Fail(ip, kind)
	if err := d.Users.RecordLoginFailure(c.Request.Context(), ip, label, d.now(), failureRetention); err != nil {
		log.Printf("recording login failure: %v", err)
	}
}

package api

import (
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
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

// reservationKey is where rateLimited parks the attempt it reserved for the rest of the request.
const reservationKey = "authReservation"

// rateLimited reserves one attempt for each given step and returns false when the caller may
// proceed. The reservation counts against the limits immediately (see ratelimit.Reserve), so
// parallel requests cannot all pass before any failure is recorded; fail turns it into a recorded
// failure and release (defer it right after a false return) gives it back otherwise. When the
// caller is blocked it aborts with 429 (+ Retry-After and a JSON body) and returns true. Blocks are
// logged by address only.
func (d *AuthDeps) rateLimited(c *gin.Context, kinds ...ratelimit.Kind) bool {
	ip := c.ClientIP()
	res, wait := d.Limiter.Reserve(ip, kinds...)
	if wait <= 0 {
		c.Set(reservationKey, res)
		return false
	}
	secs := int(math.Ceil(wait.Seconds()))
	steps := make([]string, len(kinds))
	for i, k := range kinds {
		steps[i] = string(k)
	}
	log.Printf("auth rate limit: blocked %s step=%s retryAfter=%ds", ip, strings.Join(steps, "+"), secs)
	c.Header("Retry-After", strconv.Itoa(secs))
	c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
		"error":             "too many attempts, try again later",
		"retryAfterSeconds": secs,
	})
	return true
}

func reservationOf(c *gin.Context) *ratelimit.Reservation {
	v, _ := c.Get(reservationKey)
	res, _ := v.(*ratelimit.Reservation)
	return res
}

// release gives back the attempt rateLimited reserved, if no failure has been recorded for it.
func (d *AuthDeps) release(c *gin.Context) {
	reservationOf(c).Release()
}

// fail counts a failed attempt against the caller's address and the global budget for kind, and
// logs it (time, address, label — never what was typed) for the security notice.
func (d *AuthDeps) fail(c *gin.Context, kind ratelimit.Kind, label string) {
	ip := c.ClientIP()
	if res := reservationOf(c); res != nil {
		res.Fail(kind)
	} else {
		d.Limiter.Fail(ip, kind)
	}
	if err := d.Users.RecordLoginFailure(c.Request.Context(), ip, label, d.now(), failureRetention); err != nil {
		log.Printf("recording login failure: %v", err)
	}
}

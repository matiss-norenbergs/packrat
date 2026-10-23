package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

// authSource records how a request proved its session, so RequireCSRF can tell
// an ambient (cookie) credential from one the client attached explicitly.
type authSource string

const (
	authSourceCookie authSource = "cookie"
	authSourceBearer authSource = "bearer"
	authSourceQuery  authSource = "query"
)

const authSourceKey = "authSource"

// sessionKey holds the authenticated *models.Session (token included: never serialize or log it).
const sessionKey = "session"

// desktopClientHeader marks a request from the desktop app (see AuthLogin/AuthSetup): it gets the
// session token back in the response body instead of cookies, which a cross-origin client can't
// use reliably.
const (
	clientHeader  = "X-Client"
	clientDesktop = "desktop"
)

func isDesktopClient(c *gin.Context) bool {
	return c.GetHeader(clientHeader) == clientDesktop
}

type sessionCandidate struct {
	token  string
	source authSource
}

// sessionCandidates lists the credentials a request carries, in the order they are tried:
// Authorization bearer, the session cookie, then a ?token= query parameter. The query form exists
// only for requests a browser makes without script control (<img>/<video> src, WebSocket), which
// can't set headers — so it is accepted for GET/HEAD alone, never for anything that mutates.
func sessionCandidates(c *gin.Context) []sessionCandidate {
	var out []sessionCandidate
	if h := c.GetHeader("Authorization"); len(h) > len("Bearer ") && strings.EqualFold(h[:len("Bearer ")], "Bearer ") {
		out = append(out, sessionCandidate{strings.TrimSpace(h[len("Bearer "):]), authSourceBearer})
	}
	if token, err := c.Cookie(sessionCookieName); err == nil && token != "" {
		out = append(out, sessionCandidate{token, authSourceCookie})
	}
	if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead {
		if token := c.Query("token"); token != "" {
			out = append(out, sessionCandidate{token, authSourceQuery})
		}
	}
	return out
}

// resolveSession returns the first valid session among the request's credentials and how it was
// presented, or ok=false when none is valid.
func resolveSession(c *gin.Context, usersRepo *repository.UsersRepo) (session *models.Session, source authSource, ok bool) {
	for _, cand := range sessionCandidates(c) {
		s, err := usersRepo.GetValidSession(c.Request.Context(), cand.token)
		if err == nil {
			return s, cand.source, true
		}
	}
	return nil, "", false
}

// RequireAuth aborts with 401 unless the request carries a valid session —
// via the session cookie (web), an Authorization bearer token or, for GET/HEAD,
// a ?token= query parameter (desktop). Protects everything except /health and
// /auth/*.
func RequireAuth(usersRepo *repository.UsersRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		session, source, ok := resolveSession(c, usersRepo)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Set("userID", session.UserID)
		c.Set(sessionKey, session)
		c.Set(authSourceKey, source)
		// last_seen_at is only written when the row we just read is stale, so a busy session costs
		// one write a minute, not one per request. Best effort: a failed touch never fails the request.
		if session.LastSeenAt == nil || time.Since(*session.LastSeenAt) >= repository.SessionTouchInterval {
			_ = usersRepo.TouchSession(c.Request.Context(), session.Token, time.Now())
		}
		c.Next()
	}
}

package api

import (
	"crypto/subtle"
	"net/http"

	"github.com/gin-gonic/gin"
)

const csrfCookieName = "packrat_csrf"

// setCSRFCookie mirrors setSessionCookie's SameSite/Secure reasoning exactly, except httpOnly is
// false — the frontend must be able to read this cookie's value via document.cookie to echo it
// back in a header, which is the whole double-submit-cookie mechanism.
func setCSRFCookie(c *gin.Context, value string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(csrfCookieName, value, int(sessionDuration.Seconds()), "/", "", false, false)
}

// generateCSRFToken returns a fresh random CSRF value (32 bytes, hex). It is deliberately unrelated
// to the session token: the CSRF cookie is readable by script, so it must never carry (or let
// anyone derive) the credential that the HttpOnly session cookie protects.
func generateCSRFToken() (string, error) {
	return generateSessionToken()
}

// healLegacyCSRFCookie replaces a CSRF cookie that still equals its session token — what logins
// before this fix issued, which handed script a copy of the session credential — with a fresh
// random value, so existing browser sessions are repaired without a new login. It acts only on
// cookie-authenticated GET/HEAD requests: a mutating request has already passed the double-submit
// check, and rotating under one could race a sibling in flight. A request that read the old cookie
// just before the rotation lands can still 403; the frontend retries that once with the new value.
func healLegacyCSRFCookie(c *gin.Context, sessionToken string, source authSource) {
	if source != authSourceCookie || (c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead) {
		return
	}
	cur, err := c.Cookie(csrfCookieName)
	if err != nil || subtle.ConstantTimeCompare([]byte(cur), []byte(sessionToken)) != 1 {
		return
	}
	if fresh, err := generateCSRFToken(); err == nil {
		setCSRFCookie(c, fresh)
	}
}

func clearCSRFCookie(c *gin.Context) {
	c.SetCookie(csrfCookieName, "", -1, "/", "", false, false)
}

// RequireCSRF no-ops for GET/HEAD/OPTIONS (safe methods never mutate, so there's nothing to
// forge) and otherwise requires the X-CSRF-Token header to match the packrat_csrf cookie. An
// attacker's page can get a forged cross-site request sent with the session cookie attached, but
// cross-origin JS can never read the CSRF cookie's value to also set a matching header.
func RequireCSRF() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			c.Next()
			return
		}

		// A bearer/query token is attached by the client explicitly; a browser never sends one
		// on a forged cross-site request, so the double-submit defense has nothing to protect.
		// Only a request that authenticated by cookie (ambient credential) needs the check.
		if src, _ := c.Get(authSourceKey); src == authSourceBearer || src == authSourceQuery {
			c.Next()
			return
		}

		cookieVal, err := c.Cookie(csrfCookieName)
		header := c.GetHeader("X-CSRF-Token")
		// Constant-time compare: the cookie value is a secret the double-submit pattern relies on
		// an attacker not being able to read directly, so a plain != would leak it byte-by-byte
		// through a timing side-channel over many requests.
		if err != nil || header == "" || subtle.ConstantTimeCompare([]byte(header), []byte(cookieVal)) != 1 {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "invalid or missing CSRF token"})
			return
		}
		c.Next()
	}
}

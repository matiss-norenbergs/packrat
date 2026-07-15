package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

const csrfCookieName = "packrat_csrf"

// setCSRFCookie mirrors setSessionCookie's SameSite/Secure reasoning exactly, except httpOnly is
// false — the frontend must be able to read this cookie's value via document.cookie to echo it
// back in a header, which is the whole double-submit-cookie mechanism.
func setCSRFCookie(c *gin.Context, token string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(csrfCookieName, token, int(sessionDuration.Seconds()), "/", "", false, false)
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

		cookieVal, err := c.Cookie(csrfCookieName)
		header := c.GetHeader("X-CSRF-Token")
		if err != nil || header == "" || header != cookieVal {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "invalid or missing CSRF token"})
			return
		}
		c.Next()
	}
}

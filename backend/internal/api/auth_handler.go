package api

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"packrat/backend/internal/ratelimit"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/twofactor"
)

const sessionCookieName = "packrat_session"
const sessionDuration = 30 * 24 * time.Hour

// generateSessionToken returns a 64-character hex-encoded random token — an
// opaque value with no embedded/signed data, validated purely by a
// server-side lookup (see UsersRepo.GetValidSession).
func generateSessionToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// maxUserAgentLen caps the stored User-Agent; it is only shown back to the owner as a device label.
const maxUserAgentLen = 256

// startSession mints a token and records the session with the device it came from: the client
// kind (X-Client header), the address and a truncated User-Agent. Returns the token.
func startSession(c *gin.Context, usersRepo *repository.UsersRepo, userID int64) (string, error) {
	token, err := generateSessionToken()
	if err != nil {
		return "", err
	}
	client := "web"
	if isDesktopClient(c) {
		client = clientDesktop
	}
	ua := c.GetHeader("User-Agent")
	if r := []rune(ua); len(r) > maxUserAgentLen {
		ua = string(r[:maxUserAgentLen])
	}
	meta := repository.SessionMeta{Client: client, IP: c.ClientIP(), UserAgent: ua}
	if err := usersRepo.CreateSession(c.Request.Context(), token, userID, time.Now().Add(sessionDuration), meta); err != nil {
		return "", err
	}
	return token, nil
}

func setSessionCookie(c *gin.Context, token string) {
	c.SetSameSite(http.SameSiteLaxMode)
	// Secure is deliberately false: this app is commonly deployed over plain
	// HTTP on a trusted LAN (Docker on a home server) — forcing Secure would
	// silently break login for that default deployment story.
	c.SetCookie(sessionCookieName, token, int(sessionDuration.Seconds()), "/", "", false, true)
}

// respondWithSession hands a freshly created session to the client. The web UI gets its session
// cookie plus an independent random CSRF cookie (204); the desktop app, which is cross-origin and
// can't rely on cookies, asks for the token in the body via the X-Client: desktop header and sends
// it as a bearer token.
func respondWithSession(c *gin.Context, token string) {
	if isDesktopClient(c) {
		c.JSON(http.StatusOK, TokenResponse{Token: token})
		return
	}
	csrf, err := generateCSRFToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	setSessionCookie(c, token)
	setCSRFCookie(c, csrf)
	c.Status(http.StatusNoContent)
}

func clearSessionCookie(c *gin.Context) {
	c.SetCookie(sessionCookieName, "", -1, "/", "", false, true)
}

// AuthStatus reports whether the first-run setup wizard should be shown
// (no user exists yet) and whether the current request is already
// authenticated — the frontend uses this to decide which of setup/login/app
// to render, without needing three separate round-trips.
func AuthStatus(usersRepo *repository.UsersRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		count, err := usersRepo.Count(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if count == 0 {
			c.JSON(http.StatusOK, AuthStatusResponse{SetupRequired: true, Authenticated: false})
			return
		}

		session, source, authenticated := resolveSession(c, usersRepo)
		if authenticated {
			healLegacyCSRFCookie(c, session.Token, source)
		}
		c.JSON(http.StatusOK, AuthStatusResponse{SetupRequired: false, Authenticated: authenticated})
	}
}

// AuthSetup creates the single admin account. Only allowed while no user
// exists yet — once an account exists, this always 409s (there is no
// route to add a second user, by design).
func AuthSetup(usersRepo *repository.UsersRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req SetupRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		count, err := usersRepo.Count(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if count > 0 {
			c.JSON(http.StatusConflict, gin.H{"error": "setup already completed"})
			return
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		user, err := usersRepo.Create(c.Request.Context(), req.Username, string(hash))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		token, err := startSession(c, usersRepo, user.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		respondWithSession(c, token)
	}
}

// AuthLogin validates credentials and starts a session. Bad username and bad
// password both report the same generic error — never reveal which one was
// wrong.
func AuthLogin(deps *AuthDeps) gin.HandlerFunc {
	usersRepo := deps.Users
	return func(c *gin.Context) {
		if deps.rateLimited(c, ratelimit.KindPassword) {
			return
		}
		var req LoginRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		user, err := usersRepo.GetByUsername(c.Request.Context(), req.Username)
		if errors.Is(err, repository.ErrNotFound) {
			deps.fail(c, ratelimit.KindPassword, "password")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid username or password"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)) != nil {
			deps.fail(c, ratelimit.KindPassword, "password")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid username or password"})
			return
		}
		// With 2FA on, a correct password only earns a challenge: no session, cookie or token
		// (for the desktop client either) until POST /auth/login/2fa. The limiter isn't reset
		// yet, since this isn't a completed login.
		if user.TOTPEnabled {
			challenge, err := deps.Challenges.Create(user.ID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusOK, TwoFactorChallengeResponse{
				TwoFactorRequired: true,
				ChallengeToken:    challenge,
				ExpiresInSeconds:  int(twofactor.ChallengeTTL.Seconds()),
			})
			return
		}
		deps.Limiter.Success(c.ClientIP())

		token, err := startSession(c, usersRepo, user.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		respondWithSession(c, token)
	}
}

// ChangePassword updates the authenticated user's password. Requires the
// current password to be provided and correct — protected routes alone
// aren't sufficient here since a stolen/left-open session shouldn't be
// enough on its own to lock the real owner out via a silent password swap.
func ChangePassword(deps *AuthDeps) gin.HandlerFunc {
	usersRepo := deps.Users
	return func(c *gin.Context) {
		if deps.rateLimited(c, ratelimit.KindPassword) {
			return
		}
		var req ChangePasswordRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		userID := c.MustGet("userID").(int64)
		user, err := usersRepo.GetByID(c.Request.Context(), userID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.CurrentPassword)) != nil {
			deps.fail(c, ratelimit.KindPassword, "change-password")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "current password is incorrect"})
			return
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := usersRepo.UpdatePasswordHash(c.Request.Context(), userID, string(hash)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

// AuthLogout deletes the session server-side (a replayed old cookie value
// stops working immediately, not just client-side) and clears the cookie.
func AuthLogout(usersRepo *repository.UsersRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		for _, cand := range sessionCandidates(c) {
			if err := usersRepo.DeleteSession(c.Request.Context(), cand.token); err != nil && !errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		clearSessionCookie(c)
		clearCSRFCookie(c)
		c.Status(http.StatusNoContent)
	}
}

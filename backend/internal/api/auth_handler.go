package api

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"packrat/backend/internal/repository"
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

func setSessionCookie(c *gin.Context, token string) {
	c.SetSameSite(http.SameSiteLaxMode)
	// Secure is deliberately false: this app is commonly deployed over plain
	// HTTP on a trusted LAN (Docker on a home server) — forcing Secure would
	// silently break login for that default deployment story.
	c.SetCookie(sessionCookieName, token, int(sessionDuration.Seconds()), "/", "", false, true)
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

		authenticated := false
		if token, err := c.Cookie(sessionCookieName); err == nil {
			if _, err := usersRepo.GetValidSession(c.Request.Context(), token); err == nil {
				authenticated = true
			}
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

		token, err := generateSessionToken()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := usersRepo.CreateSession(c.Request.Context(), token, user.ID, time.Now().Add(sessionDuration)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		setSessionCookie(c, token)
		setCSRFCookie(c, token)
		c.Status(http.StatusNoContent)
	}
}

// AuthLogin validates credentials and starts a session. Bad username and bad
// password both report the same generic error — never reveal which one was
// wrong.
func AuthLogin(usersRepo *repository.UsersRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req LoginRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		user, err := usersRepo.GetByUsername(c.Request.Context(), req.Username)
		if errors.Is(err, repository.ErrNotFound) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid username or password"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)) != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid username or password"})
			return
		}

		token, err := generateSessionToken()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := usersRepo.CreateSession(c.Request.Context(), token, user.ID, time.Now().Add(sessionDuration)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		setSessionCookie(c, token)
		setCSRFCookie(c, token)
		c.Status(http.StatusNoContent)
	}
}

// ChangePassword updates the authenticated user's password. Requires the
// current password to be provided and correct — protected routes alone
// aren't sufficient here since a stolen/left-open session shouldn't be
// enough on its own to lock the real owner out via a silent password swap.
func ChangePassword(usersRepo *repository.UsersRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
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
		if token, err := c.Cookie(sessionCookieName); err == nil {
			if err := usersRepo.DeleteSession(c.Request.Context(), token); err != nil && !errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}
		clearSessionCookie(c)
		clearCSRFCookie(c)
		c.Status(http.StatusNoContent)
	}
}

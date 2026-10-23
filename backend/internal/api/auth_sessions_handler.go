package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

func currentSession(c *gin.Context) *models.Session {
	return c.MustGet(sessionKey).(*models.Session)
}

func formatSessionTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

// ListSessions returns the signed-in devices, most recently active first, marking the one making
// the request. The session token is never part of the response; each entry carries a separate id.
func ListSessions(usersRepo *repository.UsersRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		cur := currentSession(c)
		sessions, err := usersRepo.ListSessions(c.Request.Context(), cur.UserID)
		if err != nil {
			internalError(c, err)
			return
		}
		out := make([]SessionResponse, 0, len(sessions))
		for _, s := range sessions {
			lastSeen := s.CreatedAt
			if s.LastSeenAt != nil {
				lastSeen = *s.LastSeenAt
			}
			out = append(out, SessionResponse{
				ID:         s.PublicID,
				Client:     s.Client,
				IP:         s.IP,
				UserAgent:  s.UserAgent,
				CreatedAt:  formatSessionTime(s.CreatedAt),
				LastSeenAt: formatSessionTime(lastSeen),
				Current:    s.Token == cur.Token,
			})
		}
		c.JSON(http.StatusOK, SessionsResponse{Sessions: out})
	}
}

// RevokeSession signs one device out. Revoking the session the request itself uses is a logout
// (cookies are cleared too). An unknown id, or another user's, is 404.
func RevokeSession(usersRepo *repository.UsersRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		cur := currentSession(c)
		id := c.Param("id")
		if err := usersRepo.DeleteSessionByPublicID(c.Request.Context(), cur.UserID, id); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
				return
			}
			internalError(c, err)
			return
		}
		if id == cur.PublicID {
			clearSessionCookie(c)
			clearCSRFCookie(c)
		}
		c.Status(http.StatusNoContent)
	}
}

// RevokeOtherSessions signs out every device but this one.
func RevokeOtherSessions(usersRepo *repository.UsersRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		cur := currentSession(c)
		n, err := usersRepo.DeleteOtherSessions(c.Request.Context(), cur.UserID, cur.Token)
		if err != nil {
			internalError(c, err)
			return
		}
		c.JSON(http.StatusOK, RevokeOthersResponse{Revoked: n})
	}
}

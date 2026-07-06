package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/repository"
)

// RequireAuth aborts with 401 unless the request carries a valid session
// cookie. Protects everything except /health and /auth/*.
func RequireAuth(usersRepo *repository.UsersRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie(sessionCookieName)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		session, err := usersRepo.GetValidSession(c.Request.Context(), token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Set("userID", session.UserID)
		c.Next()
	}
}

package api

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/hostactions"
)

// HostActionResponse is what the UI sees of a configured action — never its
// URL or token.
type HostActionResponse struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Confirm bool   `json:"confirm"`
}

type RunHostActionResponse struct {
	OK      bool   `json:"ok"`
	Status  int    `json:"status"`
	Message string `json:"message"`
}

// ListHostActions backs the sidebar's Actions menu; an empty list hides it.
func ListHostActions(actions []hostactions.Action) gin.HandlerFunc {
	return func(c *gin.Context) {
		out := make([]HostActionResponse, 0, len(actions))
		for _, a := range actions {
			out = append(out, HostActionResponse{ID: a.ID, Label: a.Label, Confirm: a.Confirm})
		}
		c.JSON(http.StatusOK, out)
	}
}

// RunHostAction sends the configured request and relays the target's answer.
// A target that answered (any status) is a 200 with ok reflecting its 2xx-ness;
// one that couldn't be reached at all is a 502.
func RunHostAction(actions []hostactions.Action) gin.HandlerFunc {
	byID := make(map[string]hostactions.Action, len(actions))
	for _, a := range actions {
		byID[a.ID] = a
	}
	return func(c *gin.Context) {
		a, ok := byID[c.Param("id")]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "action not found"})
			return
		}
		res, err := hostactions.Run(c.Request.Context(), a)
		if err != nil {
			log.Printf("host action %q failed: %v", a.Label, err)
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		log.Printf("host action %q: HTTP %d", a.Label, res.Status)
		c.JSON(http.StatusOK, RunHostActionResponse{OK: res.OK, Status: res.Status, Message: res.Message})
	}
}

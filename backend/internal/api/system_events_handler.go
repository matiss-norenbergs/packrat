package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
	"packrat/backend/internal/sysevents"
)

const (
	systemEventsDefaultPageSize = 50
	systemEventsMaxPageSize     = 200
	// systemEventsMaxDeleteIDs caps one DELETE by ids.
	systemEventsMaxDeleteIDs = 1000
)

var systemEventLevels = []string{sysevents.LevelInfo, sysevents.LevelWarning, sysevents.LevelError}

// RegisterSystemEventRoutes mounts the system log routes on g (already behind auth and CSRF). The
// whole group is rejected while the log is switched off in Settings -> History; stored events are
// kept and come back when it is switched on again.
func RegisterSystemEventRoutes(g *gin.RouterGroup, repo *repository.SystemEventsRepo, settings *repository.SettingsRepo) {
	only := RequireFeatureIn(settings, models.SettingFeatureSystemEventsEnabled, "The system log", "Settings → History")
	g.GET("/system-events", only, ListSystemEvents(repo))
	g.GET("/system-events/facets", only, SystemEventFacets(repo))
	g.DELETE("/system-events", only, DeleteSystemEvents(repo))
}

// SystemEventResponse is one event as the API returns it.
type SystemEventResponse struct {
	ID        int64           `json:"id"`
	CreatedAt string          `json:"createdAt"` // RFC 3339, UTC
	Level     string          `json:"level"`
	Category  string          `json:"category"`
	Message   string          `json:"message"`
	Details   json.RawMessage `json:"details"` // an object, or null
}

type SystemEventsResponse struct {
	Items    []SystemEventResponse `json:"items"`
	Total    int                   `json:"total"`
	Page     int                   `json:"page"`
	PageSize int                   `json:"pageSize"`
}

type SystemEventFacetResponse struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}

type SystemEventFacetsResponse struct {
	Levels     []SystemEventFacetResponse `json:"levels"`
	Categories []SystemEventFacetResponse `json:"categories"`
}

// DeleteSystemEventsRequest: exactly one of ids / all.
type DeleteSystemEventsRequest struct {
	IDs []int64 `json:"ids"`
	All bool    `json:"all"`
}

// multiParam collects a parameter that may repeat (?level=a&level=b) or be comma-separated
// (?level=a,b), dropping blanks and duplicates.
func multiParam(c *gin.Context, name string) []string {
	seen := map[string]bool{}
	var out []string
	for _, raw := range c.QueryArray(name) {
		for _, v := range strings.Split(raw, ",") {
			v = strings.TrimSpace(v)
			if v == "" || seen[v] {
				continue
			}
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

func containsString(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

// parseEventTime reads an RFC 3339 timestamp or a YYYY-MM-DD date (UTC). dateOnly reports which.
func parseEventTime(v string) (t time.Time, dateOnly bool, err error) {
	if t, err = time.Parse(time.RFC3339, v); err == nil {
		return t, false, nil
	}
	if t, err = time.Parse("2006-01-02", v); err == nil {
		return t, true, nil
	}
	return time.Time{}, false, fmt.Errorf("%q is not an RFC 3339 timestamp or a YYYY-MM-DD date", v)
}

// parseSystemEventQuery validates the query string. Every error is a message for a 400.
func parseSystemEventQuery(c *gin.Context) (repository.SystemEventQuery, error) {
	q := repository.SystemEventQuery{Sort: "createdAt", Desc: true, Page: 1, PageSize: systemEventsDefaultPageSize}

	q.Levels = multiParam(c, "level")
	for _, l := range q.Levels {
		if !containsString(systemEventLevels, l) {
			return q, fmt.Errorf("unknown level %q (use %s)", l, strings.Join(systemEventLevels, ", "))
		}
	}
	q.Categories = multiParam(c, "category")
	for _, cat := range q.Categories {
		if !containsString(sysevents.Categories, cat) {
			return q, fmt.Errorf("unknown category %q", cat)
		}
	}
	q.Text = strings.TrimSpace(c.Query("q"))

	if v := c.Query("from"); v != "" {
		t, _, err := parseEventTime(v)
		if err != nil {
			return q, fmt.Errorf("from: %w", err)
		}
		q.From = &t
	}
	if v := c.Query("to"); v != "" {
		t, dateOnly, err := parseEventTime(v)
		if err != nil {
			return q, fmt.Errorf("to: %w", err)
		}
		// Inclusive: a bare date covers that whole day, a timestamp covers its own second.
		if dateOnly {
			t = t.AddDate(0, 0, 1)
		} else {
			t = t.Add(time.Second)
		}
		q.Before = &t
	}
	if q.From != nil && q.Before != nil && !q.From.Before(*q.Before) {
		return q, fmt.Errorf("from must not be after to")
	}

	if v := c.Query("page"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			return q, fmt.Errorf("page must be a whole number of 1 or more")
		}
		q.Page = n
	}
	if v := c.Query("pageSize"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			return q, fmt.Errorf("pageSize must be a whole number of 1 or more")
		}
		q.PageSize = min(n, systemEventsMaxPageSize)
	}
	if v := c.Query("sort"); v != "" {
		if !repository.ValidSystemEventSort(v) {
			return q, fmt.Errorf("unknown sort %q (use createdAt, level or category)", v)
		}
		q.Sort = v
	}
	switch c.Query("dir") {
	case "", "desc":
	case "asc":
		q.Desc = false
	default:
		return q, fmt.Errorf("dir must be asc or desc")
	}
	return q, nil
}

func toSystemEventResponse(e models.SystemEvent) SystemEventResponse {
	details := e.Details
	if len(details) == 0 {
		details = json.RawMessage("null")
	}
	return SystemEventResponse{
		ID:        e.ID,
		CreatedAt: e.CreatedAt.UTC().Format(time.RFC3339),
		Level:     e.Level,
		Category:  e.Category,
		Message:   e.Message,
		Details:   details,
	}
}

// ListSystemEvents is GET /api/system-events: filtering, sorting and paging all happen in SQL.
func ListSystemEvents(repo *repository.SystemEventsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		q, err := parseSystemEventQuery(c)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		events, total, err := repo.Query(c.Request.Context(), q)
		if err != nil {
			writeServerError(c, err)
			return
		}
		items := make([]SystemEventResponse, len(events))
		for i, e := range events {
			items[i] = toSystemEventResponse(e)
		}
		c.JSON(http.StatusOK, SystemEventsResponse{Items: items, Total: total, Page: q.Page, PageSize: q.PageSize})
	}
}

func facetResponses(in []repository.SystemEventFacet) []SystemEventFacetResponse {
	out := make([]SystemEventFacetResponse, len(in))
	for i, f := range in {
		out[i] = SystemEventFacetResponse{Value: f.Value, Count: f.Count}
	}
	return out
}

// SystemEventFacets is GET /api/system-events/facets: the values present and their counts over all
// stored events, for the filter dropdowns.
func SystemEventFacets(repo *repository.SystemEventsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		levels, categories, err := repo.Facets(c.Request.Context())
		if err != nil {
			writeServerError(c, err)
			return
		}
		c.JSON(http.StatusOK, SystemEventFacetsResponse{Levels: facetResponses(levels), Categories: facetResponses(categories)})
	}
}

// DeleteSystemEvents is DELETE /api/system-events: {"ids":[...]} or {"all":true}, exactly one.
// Deleting is not itself recorded as an event.
func DeleteSystemEvents(repo *repository.SystemEventsRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req DeleteSystemEventsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		hasIDs := len(req.IDs) > 0
		if hasIDs == req.All {
			c.JSON(http.StatusBadRequest, gin.H{"error": `send exactly one of "ids" (a non-empty list) or "all": true`})
			return
		}
		var deleted int64
		var err error
		if req.All {
			deleted, err = repo.DeleteAll(c.Request.Context())
		} else {
			if len(req.IDs) > systemEventsMaxDeleteIDs {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("at most %d ids per request", systemEventsMaxDeleteIDs)})
				return
			}
			deleted, err = repo.DeleteByIDs(c.Request.Context(), req.IDs)
		}
		if err != nil {
			writeServerError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"deleted": deleted})
	}
}

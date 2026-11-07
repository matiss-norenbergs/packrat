package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

type evAPI struct {
	*authTestEnv
	cookies []*http.Cookie
	token   string
}

func newEvAPI(t *testing.T) *evAPI {
	t.Helper()
	e := newAuthTestEnv(t)
	cookies, token := setupAndLogin(t, e.r)
	return &evAPI{authTestEnv: e, cookies: cookies, token: token}
}

func (e *evAPI) seed(t *testing.T, at, level, category, message string, details string) int64 {
	t.Helper()
	var d any
	if details != "" {
		d = details
	}
	res, err := e.conn.Exec(`INSERT INTO system_events (created_at, level, category, message, details) VALUES (?, ?, ?, ?, ?)`, at, level, category, message, d)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

func (e *evAPI) get(path string) *httptest.ResponseRecorder {
	return authDo(e.r, authReq{method: "GET", path: path, headers: e.bearer(e.token)})
}

func (e *evAPI) list(t *testing.T, query string) SystemEventsResponse {
	t.Helper()
	w := e.get("/api/system-events" + query)
	if w.Code != http.StatusOK {
		t.Fatalf("GET %s: %d %s", query, w.Code, w.Body)
	}
	return jsonBody[SystemEventsResponse](t, w)
}

func ids(r SystemEventsResponse) []int64 {
	out := make([]int64, len(r.Items))
	for i, it := range r.Items {
		out[i] = it.ID
	}
	return out
}

func equalIDs(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func (e *evAPI) seedSet(t *testing.T) (a, b, c, d int64) {
	a = e.seed(t, "2026-03-01 10:00:00", "info", "startup", "Packrat started", `{"appVersion":"1.0.0"}`)
	b = e.seed(t, "2026-03-02 10:00:00", "warning", "backup", "Scheduled backup failed", "")
	c = e.seed(t, "2026-03-03 10:00:00", "error", "ytdlp", "yt-dlp update failed", `{"error":"boom"}`)
	d = e.seed(t, "2026-03-04 10:00:00", "info", "security", "Password changed", "")
	return
}

func TestSystemEventsAPIListShapeAndDefaults(t *testing.T) {
	e := newEvAPI(t)
	a, _, _, d := e.seedSet(t)

	w := e.get("/api/system-events")
	if w.Code != http.StatusOK {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var raw map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	if raw["total"] != float64(4) || raw["page"] != float64(1) || raw["pageSize"] != float64(50) {
		t.Fatalf("envelope: %v", raw)
	}
	items := raw["items"].([]any)
	first := items[0].(map[string]any)
	for _, k := range []string{"id", "createdAt", "level", "category", "message", "details"} {
		if _, ok := first[k]; !ok {
			t.Fatalf("item has no %q: %v", k, first)
		}
	}
	if first["id"] != float64(d) || first["createdAt"] != "2026-03-04T10:00:00Z" || first["details"] != nil {
		t.Fatalf("newest first, details null when absent: %v", first)
	}
	last := items[3].(map[string]any)
	if last["id"] != float64(a) || last["details"].(map[string]any)["appVersion"] != "1.0.0" {
		t.Fatalf("details is an object: %v", last)
	}
}

func TestSystemEventsAPIFilters(t *testing.T) {
	e := newEvAPI(t)
	a, b, c, d := e.seedSet(t)

	cases := []struct {
		query string
		want  []int64
	}{
		{"?level=info", []int64{d, a}},
		{"?level=warning&level=error", []int64{c, b}},
		{"?level=warning,error", []int64{c, b}},
		{"?category=backup", []int64{b}},
		{"?category=backup&category=ytdlp", []int64{c, b}},
		{"?category=backup,security", []int64{d, b}},
		{"?level=info&category=security", []int64{d}},
		{"?q=FAILED", []int64{c, b}},
		{"?q=nothing-like-this", []int64{}},
		{"?from=2026-03-03", []int64{d, c}},
		{"?to=2026-03-02", []int64{b, a}},                 // a bare date includes that whole day
		{"?from=2026-03-02&to=2026-03-03", []int64{c, b}}, // both ends inclusive
		{"?from=2026-03-02T10:00:00Z&to=2026-03-03T10:00:00Z", []int64{c, b}},
		{"?to=2026-03-03T09:59:59Z", []int64{b, a}},
		{"?sort=createdAt&dir=asc", []int64{a, b, c, d}},
		{"?sort=level&dir=asc", []int64{c, a, d, b}},
		{"?sort=category&dir=desc", []int64{c, a, d, b}},
		{"?page=2&pageSize=3", []int64{a}},
	}
	for _, tc := range cases {
		got := ids(e.list(t, tc.query))
		if !equalIDs(got, tc.want) {
			t.Errorf("%s: got %v, want %v", tc.query, got, tc.want)
		}
	}
	// total counts all matches, not just the page.
	r := e.list(t, "?pageSize=1&level=info")
	if r.Total != 2 || len(r.Items) != 1 || r.PageSize != 1 {
		t.Fatalf("%+v", r)
	}
	// Special characters in q are data, not SQL or LIKE syntax.
	if r := e.list(t, "?q="+url.QueryEscape("%' OR 1=1 --")); r.Total != 0 {
		t.Fatalf("injection-shaped q matched %d", r.Total)
	}
}

func TestSystemEventsAPIPageSizeIsCapped(t *testing.T) {
	e := newEvAPI(t)
	e.seedSet(t)
	if r := e.list(t, "?pageSize=100000"); r.PageSize != 200 {
		t.Fatalf("pageSize = %d, want the cap of 200", r.PageSize)
	}
}

func TestSystemEventsAPIInvalidValuesAre400(t *testing.T) {
	e := newEvAPI(t)
	e.seedSet(t)
	for _, q := range []string{
		"?level=fatal", "?level=info,fatal", "?category=nope", "?from=yesterday", "?to=2026-13-45",
		"?from=2026-03-05&to=2026-03-01", "?page=0", "?page=-1", "?page=abc", "?pageSize=0", "?pageSize=x",
		"?sort=message", "?sort=id%3BDROP", "?dir=sideways",
	} {
		if w := e.get("/api/system-events" + q); w.Code != http.StatusBadRequest {
			t.Errorf("GET %s: %d, want 400 (%s)", q, w.Code, w.Body)
		}
	}
}

func TestSystemEventsAPIFacets(t *testing.T) {
	e := newEvAPI(t)
	e.seedSet(t)
	w := e.get("/api/system-events/facets")
	if w.Code != http.StatusOK {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	f := jsonBody[SystemEventFacetsResponse](t, w)
	if len(f.Levels) != 3 || f.Levels[2] != (SystemEventFacetResponse{Value: "warning", Count: 1}) || f.Levels[1] != (SystemEventFacetResponse{Value: "info", Count: 2}) {
		t.Fatalf("levels: %+v", f.Levels)
	}
	if len(f.Categories) != 4 {
		t.Fatalf("categories: %+v", f.Categories)
	}
	// Empty table: empty arrays, never null.
	if _, err := e.conn.Exec(`DELETE FROM system_events`); err != nil {
		t.Fatal(err)
	}
	w = e.get("/api/system-events/facets")
	if !strings.Contains(w.Body.String(), `"levels":[]`) || !strings.Contains(w.Body.String(), `"categories":[]`) {
		t.Fatalf("%s", w.Body)
	}
}

func TestSystemEventsAPIRejectedWhileOff(t *testing.T) {
	e := newEvAPI(t)
	e.seedSet(t)
	settings := repository.NewSettingsRepo(e.conn)
	if err := settings.Set(context.Background(), models.SettingFeatureSystemEventsEnabled, "false"); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"/api/system-events", "/api/system-events/facets"} {
		w := e.get(p)
		if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "Settings") || !strings.Contains(w.Body.String(), "History") {
			t.Fatalf("GET %s while off: %d %s", p, w.Code, w.Body)
		}
	}
	if w := authDo(e.r, authReq{method: "DELETE", path: "/api/system-events", body: `{"all":true}`, headers: e.bearer(e.token)}); w.Code != http.StatusForbidden {
		t.Fatalf("DELETE while off: %d", w.Code)
	}
	// Stored events are kept, and come back when it is switched on again.
	if err := settings.Set(context.Background(), models.SettingFeatureSystemEventsEnabled, "true"); err != nil {
		t.Fatal(err)
	}
	if r := e.list(t, ""); r.Total != 4 {
		t.Fatalf("events lost: %d", r.Total)
	}
}

func (e *evAPI) del(body string) *httptest.ResponseRecorder {
	return authDo(e.r, authReq{method: "DELETE", path: "/api/system-events", body: body, headers: e.bearer(e.token)})
}

func TestSystemEventsAPIDelete(t *testing.T) {
	e := newEvAPI(t)
	a, b, c, d := e.seedSet(t)

	// ids that do not exist are ignored.
	w := e.del(fmt.Sprintf(`{"ids":[%d,%d,999999]}`, a, b))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"deleted":2`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if r := e.list(t, ""); !equalIDs(ids(r), []int64{d, c}) {
		t.Fatalf("remaining %v", ids(r))
	}

	// both, neither, empty ids, all:false, too many ids, bad JSON
	for name, body := range map[string]string{
		"both":      fmt.Sprintf(`{"ids":[%d],"all":true}`, c),
		"neither":   `{}`,
		"empty ids": `{"ids":[]}`,
		"all false": `{"all":false}`,
		"bad json":  `{"ids":`,
		"bad type":  `{"ids":["x"]}`,
	} {
		if w := e.del(body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400 (%s)", name, w.Code, w.Body)
		}
	}
	if r := e.list(t, ""); r.Total != 2 {
		t.Fatalf("a rejected request deleted something: %d left", r.Total)
	}

	var many []string
	for i := 5000; i < 6001; i++ {
		many = append(many, fmt.Sprint(i))
	}
	if w := e.del(`{"ids":[` + strings.Join(many, ",") + `]}`); w.Code != http.StatusBadRequest {
		t.Fatalf("1001 ids: %d", w.Code)
	}
	if w := e.del(`{"ids":[` + strings.Join(many[:1000], ",") + `]}`); w.Code != http.StatusOK {
		t.Fatalf("1000 ids: %d %s", w.Code, w.Body)
	}

	w = e.del(`{"all":true}`)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"deleted":2`) {
		t.Fatalf("all: %d %s", w.Code, w.Body)
	}
	if r := e.list(t, ""); r.Total != 0 {
		t.Fatalf("left %d", r.Total)
	}
}

func TestSystemEventsAPIDeleteNeedsCSRFForCookieSessions(t *testing.T) {
	e := newEvAPI(t)
	e.seedSet(t)

	w := authDo(e.r, authReq{method: "DELETE", path: "/api/system-events", body: `{"all":true}`, cookies: e.cookies})
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "CSRF") {
		t.Fatalf("without CSRF: %d %s", w.Code, w.Body)
	}
	if r := e.list(t, ""); r.Total != 4 {
		t.Fatalf("deleted despite the CSRF failure: %d", r.Total)
	}
	w = authDo(e.r, authReq{method: "DELETE", path: "/api/system-events", body: `{"all":true}`, cookies: e.cookies, headers: csrfHeaders(e.cookies)})
	if w.Code != http.StatusOK {
		t.Fatalf("with CSRF: %d %s", w.Code, w.Body)
	}
	// And the routes need a session at all.
	if w := authDo(e.r, authReq{method: "GET", path: "/api/system-events"}); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d", w.Code)
	}
}

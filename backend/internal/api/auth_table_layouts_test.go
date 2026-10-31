package api

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"packrat/backend/internal/models"
	"packrat/backend/internal/repository"
)

func (e *authTestEnv) layouts(t *testing.T, method, tableID, body string, cookies []*http.Cookie) (int, string) {
	t.Helper()
	path := "/api/auth/table-layouts"
	if tableID != "" {
		path += "/" + tableID
	}
	w := authDo(e.r, authReq{method: method, path: path, body: body, cookies: cookies, headers: csrfHeaders(cookies)})
	return w.Code, strings.TrimSpace(w.Body.String())
}

func TestTableLayoutsRequireAuth(t *testing.T) {
	e := newAuthTestEnv(t)
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/auth/table-layouts"},
		{"PUT", "/api/auth/table-layouts/artists"},
		{"DELETE", "/api/auth/table-layouts/artists"},
	} {
		if w := authDo(e.r, authReq{method: c.method, path: c.path, body: `{"v":1}`}); w.Code != http.StatusUnauthorized {
			t.Errorf("%s unauthenticated: %d", c.method, w.Code)
		}
	}
}

func TestTableLayoutsRequireCSRFOnWrites(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)
	for _, m := range []string{"PUT", "DELETE"} {
		w := authDo(e.r, authReq{method: m, path: "/api/auth/table-layouts/artists", body: `{"v":1}`, cookies: cookies})
		if w.Code != http.StatusForbidden {
			t.Errorf("%s without CSRF: %d", m, w.Code)
		}
	}
	if code, body := e.layouts(t, "GET", "", "", cookies); code != 200 || body != `{"layouts":{}}` {
		t.Fatalf("a rejected write stored something: %d %s", code, body)
	}
}

func TestTableLayoutsRoundTripAndCanonicalForm(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)

	if code, body := e.layouts(t, "GET", "", "", cookies); code != 200 || body != `{"layouts":{}}` {
		t.Fatalf("empty: %d %s", code, body)
	}
	// Whitespace, field order, hidden order and empty optional fields do not survive.
	in := `{ "widths": {"b": 100, "a": 50}, "hidden": ["usage","birthday"], "sort": {"dir":"desc","key":"name"}, "v": 1 }`
	want := `{"v":1,"sort":{"key":"name","dir":"desc"},"hidden":["birthday","usage"],"widths":{"a":50,"b":100}}`
	if code, body := e.layouts(t, "PUT", "artists", in, cookies); code != 200 || body != want {
		t.Fatalf("put: %d %s", code, body)
	}
	if code, body := e.layouts(t, "GET", "", "", cookies); code != 200 || body != `{"layouts":{"artists":`+want+`}}` {
		t.Fatalf("get: %d %s", code, body)
	}
	// PUT replaces the whole layout; empty optional fields are omitted.
	if code, body := e.layouts(t, "PUT", "artists", `{"v":1,"hidden":[],"widths":{}}`, cookies); code != 200 || body != `{"v":1}` {
		t.Fatalf("replace: %d %s", code, body)
	}
	if code, body := e.layouts(t, "GET", "", "", cookies); code != 200 || body != `{"layouts":{"artists":{"v":1}}}` {
		t.Fatalf("get after replace: %d %s", code, body)
	}
	// Stored: another browser of the same account sees it.
	other := e.webLogin(t, "198.51.100.7:1234", webUA)
	if code, body := e.layouts(t, "GET", "", "", other); code != 200 || body != `{"layouts":{"artists":{"v":1}}}` {
		t.Fatalf("persisted: %d %s", code, body)
	}
}

func TestTableLayoutsRejectInvalid(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)

	many := func(n int, f func(i int) string) string {
		parts := make([]string, n)
		for i := range parts {
			parts[i] = f(i)
		}
		return strings.Join(parts, ",")
	}
	cases := map[string]string{
		"empty body":        ``,
		"not json":          `nope`,
		"null":              `null`,
		"array":             `[]`,
		"string":            `"x"`,
		"trailing data":     `{"v":1}{"v":1}`,
		"missing v":         `{}`,
		"v zero":            `{"v":0}`,
		"v two":             `{"v":2}`,
		"v string":          `{"v":"1"}`,
		"v fractional":      `{"v":1.5}`,
		"unknown field":     `{"v":1,"extra":true}`,
		"unknown sort key":  `{"v":1,"sort":{"key":"a","dir":"asc","x":1}}`,
		"bad dir":           `{"v":1,"sort":{"key":"name","dir":"up"}}`,
		"missing dir":       `{"v":1,"sort":{"key":"name"}}`,
		"missing sort key":  `{"v":1,"sort":{"dir":"asc"}}`,
		"bad sort key":      `{"v":1,"sort":{"key":"na me","dir":"asc"}}`,
		"hidden not array":  `{"v":1,"hidden":"a"}`,
		"hidden not string": `{"v":1,"hidden":[1]}`,
		"bad hidden key":    `{"v":1,"hidden":["a b"]}`,
		"empty hidden key":  `{"v":1,"hidden":[""]}`,
		"long hidden key":   `{"v":1,"hidden":["` + strings.Repeat("a", 65) + `"]}`,
		"duplicate hidden":  `{"v":1,"hidden":["a","a"]}`,
		"too many hidden":   `{"v":1,"hidden":[` + many(65, func(i int) string { return fmt.Sprintf(`"c%d"`, i) }) + `]}`,
		"bad width key":     `{"v":1,"widths":{"a b":100}}`,
		"width too small":   `{"v":1,"widths":{"a":23}}`,
		"width too large":   `{"v":1,"widths":{"a":2001}}`,
		"width fractional":  `{"v":1,"widths":{"a":100.5}}`,
		"width string":      `{"v":1,"widths":{"a":"100"}}`,
		"too many widths":   `{"v":1,"widths":{` + many(65, func(i int) string { return fmt.Sprintf(`"c%d":100`, i) }) + `}}`,
		"oversized body":    `{"v":1,"hidden":["` + strings.Repeat("a", 5000) + `"]}`,
	}
	for name, body := range cases {
		if code, resp := e.layouts(t, "PUT", "artists", body, cookies); code != http.StatusBadRequest || !strings.Contains(resp, `"error"`) {
			t.Errorf("%s: expected 400 with an error, got %d %s", name, code, resp)
		}
	}
	// Bounds that are valid.
	for name, body := range map[string]string{
		"min width": `{"v":1,"widths":{"a":24}}`,
		"max width": `{"v":1,"widths":{"a":2000}}`,
		"64 keys":   `{"v":1,"hidden":[` + many(64, func(i int) string { return fmt.Sprintf(`"c%d"`, i) }) + `]}`,
		"sort only": `{"v":1,"sort":{"key":"a_B-1","dir":"asc"}}`,
		"null sort": `{"v":1,"sort":null,"hidden":null,"widths":null}`,
	} {
		if code, resp := e.layouts(t, "PUT", "ok", body, cookies); code != 200 {
			t.Errorf("%s: expected 200, got %d %s", name, code, resp)
		}
	}
	// Nothing was stored by the rejected requests: only "ok" exists.
	_, body := e.layouts(t, "GET", "", "", cookies)
	if strings.Contains(body, "artists") {
		t.Fatalf("rejected requests stored a layout: %s", body)
	}
}

func TestTableLayoutsRejectBadTableID(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)
	for _, id := range []string{"Artists", "-artists", "art_ists", "art.ists", "art%20ists", strings.Repeat("a", 65), "%2e%2e"} {
		if code, _ := e.layouts(t, "PUT", id, `{"v":1}`, cookies); code != http.StatusBadRequest && code != http.StatusNotFound {
			t.Errorf("PUT %q: %d", id, code)
		}
		if code, _ := e.layouts(t, "DELETE", id, "", cookies); code != http.StatusBadRequest && code != http.StatusNotFound {
			t.Errorf("DELETE %q: %d", id, code)
		}
	}
	for _, id := range []string{"Artists", "-artists", "art_ists", strings.Repeat("a", 65)} {
		if code, resp := e.layouts(t, "PUT", id, `{"v":1}`, cookies); code != http.StatusBadRequest || !strings.Contains(resp, "invalid table id") {
			t.Errorf("PUT %q: %d %s", id, code, resp)
		}
	}
	for _, id := range []string{"a", "0", "a-b-0", strings.Repeat("a", 64)} {
		if code, resp := e.layouts(t, "PUT", id, `{"v":1}`, cookies); code != 200 {
			t.Errorf("PUT %q: %d %s", id, code, resp)
		}
	}
	if _, body := e.layouts(t, "GET", "", "", cookies); strings.Count(body, `{"v":1}`) != 4 {
		t.Fatalf("stored: %s", body)
	}
}

func TestTableLayoutsDeleteIsIdempotent(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)
	if code, _ := e.layouts(t, "DELETE", "artists", "", cookies); code != http.StatusNoContent {
		t.Fatalf("delete of nothing: %d", code)
	}
	e.layouts(t, "PUT", "artists", `{"v":1}`, cookies)
	for i := 0; i < 2; i++ {
		if code, _ := e.layouts(t, "DELETE", "artists", "", cookies); code != http.StatusNoContent {
			t.Fatalf("delete #%d: %d", i, code)
		}
	}
	if _, body := e.layouts(t, "GET", "", "", cookies); body != `{"layouts":{}}` {
		t.Fatalf("after delete: %s", body)
	}
}

func TestTableLayoutsCap(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)
	for i := 0; i < models.MaxTableLayoutsPerUser; i++ {
		if code, body := e.layouts(t, "PUT", fmt.Sprintf("t%d", i), `{"v":1}`, cookies); code != 200 {
			t.Fatalf("layout %d: %d %s", i, code, body)
		}
	}
	if code, body := e.layouts(t, "PUT", "one-more", `{"v":1}`, cookies); code != http.StatusConflict || !strings.Contains(body, "at most") {
		t.Fatalf("over the cap: %d %s", code, body)
	}
	if code, _ := e.layouts(t, "PUT", "t0", `{"v":1,"hidden":["x"]}`, cookies); code != 200 {
		t.Fatalf("updating an existing one at the cap: %d", code)
	}
}

func TestTableLayoutsAreScopedPerUserAndSession(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)
	if code, _ := e.layouts(t, "PUT", "artists", `{"v":1,"hidden":["usage"]}`, cookies); code != 200 {
		t.Fatal(code)
	}

	// No API creates a second user, so insert one and a session for it directly (a desktop bearer token).
	u2, err := e.users.Create(t.Context(), "second", "hash")
	if err != nil {
		t.Fatal(err)
	}
	const token2 = "second-user-session-token"
	if err := e.users.CreateSession(t.Context(), token2, u2.ID, e.clock.now().Add(3600e9), repository.SessionMeta{Client: "desktop"}); err != nil {
		t.Fatal(err)
	}
	bearer := map[string]string{"Authorization": "Bearer " + token2}
	w := authDo(e.r, authReq{method: "GET", path: "/api/auth/table-layouts", headers: bearer})
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"layouts":{}}` {
		t.Fatalf("second user sees %d %s", w.Code, w.Body)
	}
	// The account comes from the session: a user id in the request is ignored (the layout of
	// the second user is written under the second user).
	w = authDo(e.r, authReq{method: "PUT", path: "/api/auth/table-layouts/artists?user_id=1&userId=1", body: `{"v":1,"hidden":["birthday"]}`, headers: bearer})
	if w.Code != 200 {
		t.Fatalf("second user put: %d %s", w.Code, w.Body)
	}
	w = authDo(e.r, authReq{method: "DELETE", path: "/api/auth/table-layouts/tags?user_id=1", headers: bearer})
	if w.Code != http.StatusNoContent {
		t.Fatalf("second user delete: %d", w.Code)
	}
	if _, body := e.layouts(t, "GET", "", "", cookies); body != `{"layouts":{"artists":{"v":1,"hidden":["usage"]}}}` {
		t.Fatalf("first user's layouts changed: %s", body)
	}
	w = authDo(e.r, authReq{method: "DELETE", path: "/api/auth/table-layouts/artists", headers: bearer})
	if w.Code != http.StatusNoContent {
		t.Fatalf("second user delete own: %d", w.Code)
	}
	if _, body := e.layouts(t, "GET", "", "", cookies); body != `{"layouts":{"artists":{"v":1,"hidden":["usage"]}}}` {
		t.Fatalf("a delete by the second user removed the first user's layout: %s", body)
	}
}

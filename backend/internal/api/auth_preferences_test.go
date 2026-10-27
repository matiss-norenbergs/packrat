package api

import (
	"net/http"
	"testing"

	"packrat/backend/internal/repository"
)

func (e *authTestEnv) prefs(t *testing.T, method, body string, cookies []*http.Cookie) (int, UserPreferencesResponse) {
	t.Helper()
	w := authDo(e.r, authReq{method: method, path: "/api/auth/preferences", body: body, cookies: cookies, headers: csrfHeaders(cookies)})
	var out UserPreferencesResponse
	if w.Code == http.StatusOK {
		out = jsonBody[UserPreferencesResponse](t, w)
	}
	return w.Code, out
}

func TestPreferencesRequireAuth(t *testing.T) {
	e := newAuthTestEnv(t)
	for _, m := range []string{"GET", "PATCH"} {
		if w := authDo(e.r, authReq{method: m, path: "/api/auth/preferences", body: `{"theme":"dark"}`}); w.Code != http.StatusUnauthorized {
			t.Errorf("%s unauthenticated: %d", m, w.Code)
		}
	}
}

func TestPreferencesDefaultsPatchAndPersist(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)

	if code, p := e.prefs(t, "GET", "", cookies); code != 200 || p.Theme != "system" || p.Accent != "default" {
		t.Fatalf("defaults: %d %+v", code, p)
	}
	// Patching one key leaves the other alone.
	if code, p := e.prefs(t, "PATCH", `{"theme":"dark"}`, cookies); code != 200 || p.Theme != "dark" || p.Accent != "default" {
		t.Fatalf("patch theme: %d %+v", code, p)
	}
	if code, p := e.prefs(t, "PATCH", `{"accent":"blue"}`, cookies); code != 200 || p.Theme != "dark" || p.Accent != "blue" {
		t.Fatalf("patch accent: %d %+v", code, p)
	}
	// Stored: a fresh login (another browser) sees the same values.
	other := e.webLogin(t, "198.51.100.7:1234", webUA)
	if code, p := e.prefs(t, "GET", "", other); code != 200 || p.Theme != "dark" || p.Accent != "blue" {
		t.Fatalf("persisted: %d %+v", code, p)
	}
}

func TestPreferencesRejectInvalid(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)
	for _, body := range []string{
		`{}`, ``, `not json`, `{"nope":"x"}`, `{"theme":"purple"}`, `{"theme":1}`, `{"accent":"Blue"}`,
		`{"theme":"dark","accent":"nope"}`, // atomic: nothing is applied
	} {
		if code, _ := e.prefs(t, "PATCH", body, cookies); code != http.StatusBadRequest {
			t.Errorf("body %q: expected 400, got %d", body, code)
		}
	}
	if _, p := e.prefs(t, "GET", "", cookies); p.Theme != "system" || p.Accent != "default" {
		t.Fatalf("rejected requests changed state: %+v", p)
	}
}

func TestPreferencesAreScopedPerUser(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)
	if code, _ := e.prefs(t, "PATCH", `{"theme":"light","accent":"red"}`, cookies); code != 200 {
		t.Fatal(code)
	}

	// No API creates a second user, so insert one and a session for it directly.
	u2, err := e.users.Create(t.Context(), "second", "hash")
	if err != nil {
		t.Fatal(err)
	}
	const token2 = "second-user-session-token"
	if err := e.users.CreateSession(t.Context(), token2, u2.ID, e.clock.now().Add(3600e9), repository.SessionMeta{Client: "desktop"}); err != nil {
		t.Fatal(err)
	}
	bearer := map[string]string{"Authorization": "Bearer " + token2}
	w := authDo(e.r, authReq{method: "GET", path: "/api/auth/preferences", headers: bearer})
	if p := jsonBody[UserPreferencesResponse](t, w); w.Code != 200 || p.Theme != "system" || p.Accent != "default" {
		t.Fatalf("second user sees %d %+v", w.Code, p)
	}
	w = authDo(e.r, authReq{method: "PATCH", path: "/api/auth/preferences", body: `{"theme":"dark"}`, headers: bearer})
	if w.Code != 200 {
		t.Fatalf("second user patch: %d %s", w.Code, w.Body)
	}
	if _, p := e.prefs(t, "GET", "", cookies); p.Theme != "light" || p.Accent != "red" {
		t.Fatalf("first user's values changed: %+v", p)
	}
}

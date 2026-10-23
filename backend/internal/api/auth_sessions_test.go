package api

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"packrat/backend/internal/repository"
)

const webUA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"

// webLogin signs in as a web client with its own address and User-Agent and returns its cookies.
func (e *authTestEnv) webLogin(t *testing.T, addr, ua string) []*http.Cookie {
	t.Helper()
	hr := loginFrom(e, addr, "hunter2-hunter2", map[string]string{"User-Agent": ua})
	if hr.Code != http.StatusNoContent {
		t.Fatalf("login from %s: %d %s", addr, hr.Code, hr.Body)
	}
	return hr.Result().Cookies()
}

func csrfHeaders(cookies []*http.Cookie) map[string]string {
	return map[string]string{"X-CSRF-Token": cookieNamed(cookies, csrfCookieName)}
}

func (e *authTestEnv) listSessions(t *testing.T, q authReq) []SessionResponse {
	t.Helper()
	q.method, q.path = "GET", "/api/auth/sessions"
	w := authDo(e.r, q)
	if w.Code != http.StatusOK {
		t.Fatalf("list sessions: %d %s", w.Code, w.Body)
	}
	return jsonBody[SessionsResponse](t, w).Sessions
}

func TestSessionsListMarksCurrentAndNeverExposesTokens(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, token := setupAndLogin(t, e.r) // setup (web) + web login + desktop login
	webToken := cookieNamed(cookies, sessionCookieName)

	w := authDo(e.r, authReq{method: "GET", path: "/api/auth/sessions", cookies: cookies})
	if w.Code != http.StatusOK {
		t.Fatalf("list: %d %s", w.Code, w.Body)
	}
	for _, secret := range []string{webToken, token} {
		if strings.Contains(w.Body.String(), secret) {
			t.Fatalf("session list leaked a token: %s", w.Body)
		}
	}
	list := jsonBody[SessionsResponse](t, w).Sessions
	if len(list) != 3 {
		t.Fatalf("expected 3 sessions, got %+v", list)
	}
	var current, other *SessionResponse
	for i := range list {
		if list[i].Current {
			current = &list[i]
		} else if list[i].Client == "desktop" {
			other = &list[i]
		}
	}
	if current == nil || other == nil {
		t.Fatalf("exactly one session must be current: %+v", list)
	}
	if current.Client != "web" || other.Client != "desktop" {
		t.Fatalf("clients: current=%q other=%q", current.Client, other.Client)
	}
	if current.ID == "" || current.ID == other.ID || current.ID == webToken {
		t.Fatalf("bad ids: %+v", list)
	}

	// The bearer (desktop) credential sees the same list with itself marked current.
	for _, s := range e.listSessions(t, authReq{headers: map[string]string{"Authorization": "Bearer " + token}}) {
		if s.Current != (s.Client == "desktop") {
			t.Fatalf("bearer caller: wrong current flag on %+v", s)
		}
	}
}

func TestSessionRecordsDeviceDetails(t *testing.T) {
	e := newAuthTestEnv(t)
	setupAndLogin(t, e.r)
	cookies := e.webLogin(t, "10.1.2.3:4000", strings.Repeat("x", 1000))
	var found bool
	for _, s := range e.listSessions(t, authReq{cookies: cookies}) {
		if s.Current {
			found = true
			if s.IP != "10.1.2.3" {
				t.Fatalf("ip = %q", s.IP)
			}
			if len(s.UserAgent) != maxUserAgentLen {
				t.Fatalf("user agent not truncated: %d", len(s.UserAgent))
			}
		}
	}
	if !found {
		t.Fatal("no current session")
	}
}

func TestRevokeOneSession(t *testing.T) {
	e := newAuthTestEnv(t)
	setupAndLogin(t, e.r)
	a := e.webLogin(t, "10.0.0.1:1", webUA)
	b := e.webLogin(t, "10.0.0.2:1", webUA)

	var bID string
	for _, s := range e.listSessions(t, authReq{cookies: b}) {
		if s.Current {
			bID = s.ID
		}
	}

	// A signs B out.
	w := authDo(e.r, authReq{method: "DELETE", path: "/api/auth/sessions/" + bID, cookies: a, headers: csrfHeaders(a)})
	if w.Code != http.StatusNoContent {
		t.Fatalf("revoke: %d %s", w.Code, w.Body)
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: b}); w.Code != http.StatusUnauthorized {
		t.Fatalf("revoked session must be 401, got %d", w.Code)
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: a}); w.Code != http.StatusNoContent {
		t.Fatalf("the revoking session must still work, got %d", w.Code)
	}
	// Revoking it again is a 404.
	w = authDo(e.r, authReq{method: "DELETE", path: "/api/auth/sessions/" + bID, cookies: a, headers: csrfHeaders(a)})
	if w.Code != http.StatusNotFound {
		t.Fatalf("second revoke: expected 404, got %d", w.Code)
	}
}

func TestRevokeUnknownSessionIs404(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, token := setupAndLogin(t, e.r)
	n, _ := e.users.CountSessions(t.Context())
	for _, id := range []string{"nope", "0000000000000000", token, cookieNamed(cookies, sessionCookieName)} {
		w := authDo(e.r, authReq{method: "DELETE", path: "/api/auth/sessions/" + id, cookies: cookies, headers: csrfHeaders(cookies)})
		if w.Code != http.StatusNotFound {
			t.Fatalf("revoke %q: expected 404, got %d", id, w.Code)
		}
	}
	// A raw token is not an id: nothing may have been deleted.
	if got, _ := e.users.CountSessions(t.Context()); got != n {
		t.Fatalf("sessions changed from %d to %d", n, got)
	}
}

func TestCannotRevokeAnotherUsersSession(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)
	u, err := e.users.Create(t.Context(), "other", "hash")
	if err != nil {
		t.Fatal(err)
	}
	if err := e.users.CreateSession(t.Context(), "other-token", u.ID, time.Now().Add(time.Hour), repository.SessionMeta{}); err != nil {
		t.Fatal(err)
	}
	other, err := e.users.ListSessions(t.Context(), u.ID)
	if err != nil || len(other) != 1 {
		t.Fatalf("seeding: %v %v", other, err)
	}
	w := authDo(e.r, authReq{method: "DELETE", path: "/api/auth/sessions/" + other[0].PublicID, cookies: cookies, headers: csrfHeaders(cookies)})
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
	if _, err := e.users.GetValidSession(t.Context(), "other-token"); err != nil {
		t.Fatalf("the other user's session must survive: %v", err)
	}
	// And it never appears in this user's list.
	for _, s := range e.listSessions(t, authReq{cookies: cookies}) {
		if s.ID == other[0].PublicID {
			t.Fatal("another user's session is listed")
		}
	}
}

func TestRevokingTheCurrentSessionIsALogout(t *testing.T) {
	e := newAuthTestEnv(t)
	setupAndLogin(t, e.r)
	cookies := e.webLogin(t, "10.0.0.1:1", webUA)
	var id string
	for _, s := range e.listSessions(t, authReq{cookies: cookies}) {
		if s.Current {
			id = s.ID
		}
	}
	w := authDo(e.r, authReq{method: "DELETE", path: "/api/auth/sessions/" + id, cookies: cookies, headers: csrfHeaders(cookies)})
	if w.Code != http.StatusNoContent {
		t.Fatalf("revoke current: %d %s", w.Code, w.Body)
	}
	for _, c := range w.Result().Cookies() {
		if (c.Name == sessionCookieName || c.Name == csrfCookieName) && c.MaxAge >= 0 {
			t.Fatalf("cookie %s must be cleared, got %+v", c.Name, c)
		}
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies}); w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 after revoking own session, got %d", w.Code)
	}
}

func TestRevokeOthersKeepsTheCurrentSession(t *testing.T) {
	e := newAuthTestEnv(t)
	_, desktop := setupAndLogin(t, e.r) // setup + web login + desktop login
	web := e.webLogin(t, "10.0.0.9:1", webUA)

	w := authDo(e.r, authReq{method: "POST", path: "/api/auth/sessions/revoke-others", cookies: web, headers: csrfHeaders(web)})
	if w.Code != http.StatusOK {
		t.Fatalf("revoke-others: %d %s", w.Code, w.Body)
	}
	if got := jsonBody[RevokeOthersResponse](t, w).Revoked; got != 3 {
		t.Fatalf("revoked = %d, want 3", got)
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: web}); w.Code != http.StatusNoContent {
		t.Fatalf("current session must survive, got %d", w.Code)
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", headers: map[string]string{"Authorization": "Bearer " + desktop}}); w.Code != http.StatusUnauthorized {
		t.Fatalf("other sessions must be gone, got %d", w.Code)
	}
	if list := e.listSessions(t, authReq{cookies: web}); len(list) != 1 || !list[0].Current {
		t.Fatalf("expected only the current session, got %+v", list)
	}
	// With nobody else signed in it revokes nothing.
	w = authDo(e.r, authReq{method: "POST", path: "/api/auth/sessions/revoke-others", cookies: web, headers: csrfHeaders(web)})
	if w.Code != http.StatusOK || jsonBody[RevokeOthersResponse](t, w).Revoked != 0 {
		t.Fatalf("zero others: %d %s", w.Code, w.Body)
	}
}

func TestSessionRoutesNeedAuthAndCSRF(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)
	for _, q := range []authReq{
		{method: "GET", path: "/api/auth/sessions"},
		{method: "DELETE", path: "/api/auth/sessions/abc"},
		{method: "POST", path: "/api/auth/sessions/revoke-others"},
	} {
		if w := authDo(e.r, q); w.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s without auth: %d", q.method, q.path, w.Code)
		}
	}
	// Cookie-authenticated mutations without the CSRF header are refused, and change nothing.
	n, _ := e.users.CountSessions(t.Context())
	for _, q := range []authReq{
		{method: "DELETE", path: "/api/auth/sessions/abc", cookies: cookies},
		{method: "POST", path: "/api/auth/sessions/revoke-others", cookies: cookies},
	} {
		if w := authDo(e.r, q); w.Code != http.StatusForbidden {
			t.Fatalf("%s %s without CSRF: %d", q.method, q.path, w.Code)
		}
	}
	if got, _ := e.users.CountSessions(t.Context()); got != n {
		t.Fatalf("sessions changed without CSRF: %d -> %d", n, got)
	}
}

func TestLastSeenIsThrottled(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)
	token := cookieNamed(cookies, sessionCookieName)
	const layout = "2006-01-02 15:04:05"
	read := func() *time.Time {
		s, err := e.users.GetValidSession(t.Context(), token)
		if err != nil {
			t.Fatal(err)
		}
		return s.LastSeenAt
	}
	if read() != nil {
		t.Fatal("last_seen_at must start empty")
	}
	authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies})
	if read() == nil {
		t.Fatal("first authenticated request must record activity")
	}

	// Pin the stored value a few seconds ago: a request inside the interval must not move it.
	recent := time.Now().UTC().Add(-10 * time.Second).Format(layout)
	if _, err := e.conn.Exec(`UPDATE sessions SET last_seen_at = ? WHERE token = ?`, recent, token); err != nil {
		t.Fatal(err)
	}
	authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies})
	if got := read(); got.UTC().Format(layout) != recent {
		t.Fatalf("touched inside the throttle window: %v", got)
	}

	// Once it is older than the interval it is refreshed.
	old := time.Now().UTC().Add(-5 * time.Minute).Format(layout)
	if _, err := e.conn.Exec(`UPDATE sessions SET last_seen_at = ? WHERE token = ?`, old, token); err != nil {
		t.Fatal(err)
	}
	authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies})
	if got := read(); got.UTC().Format(layout) == old {
		t.Fatal("stale last_seen_at was not refreshed")
	}
}

func TestSessionsFromBeforeTheMigrationKeepWorking(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)
	// A row exactly as the old code wrote it: only the original columns.
	if _, err := e.conn.Exec(`INSERT INTO sessions (token, user_id, expires_at) VALUES ('legacy-token', 1, datetime('now', '+1 day'))`); err != nil {
		t.Fatal(err)
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", headers: map[string]string{"Authorization": "Bearer legacy-token"}}); w.Code != http.StatusNoContent {
		t.Fatalf("legacy session must authenticate, got %d", w.Code)
	}
	var legacy *SessionResponse
	list := e.listSessions(t, authReq{cookies: cookies})
	for i := range list {
		if list[i].Client == "" {
			legacy = &list[i]
		}
	}
	if legacy == nil || legacy.Current || legacy.LastSeenAt == "" {
		t.Fatalf("legacy session should be listed with an empty client and a last-active time: %+v", list)
	}
}

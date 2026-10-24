package api

import (
	"net/http"
	"testing"
)

// assertIndependentCSRF fails unless the cookies carry a CSRF value that is a 64-char hex string
// and neither equals nor contains the session token.
func assertIndependentCSRF(t *testing.T, cookies []*http.Cookie, what string) {
	t.Helper()
	session, csrf := cookieNamed(cookies, sessionCookieName), cookieNamed(cookies, csrfCookieName)
	if session == "" || csrf == "" {
		t.Fatalf("%s: expected session+csrf cookies, got %v", what, cookies)
	}
	if csrf == session {
		t.Fatalf("%s: CSRF cookie equals the session token", what)
	}
	if len(csrf) != 64 {
		t.Fatalf("%s: CSRF cookie should be 32 random bytes in hex, got %q", what, csrf)
	}
	for _, c := range cookies {
		if c.Name == csrfCookieName && c.HttpOnly {
			t.Fatalf("%s: CSRF cookie must stay readable by script", what)
		}
		if c.Name == sessionCookieName && !c.HttpOnly {
			t.Fatalf("%s: session cookie must stay HttpOnly", what)
		}
	}
}

func TestSetupAndLoginIssueIndependentCSRF(t *testing.T) {
	r := newAuthTestRouter(t)
	creds := `{"username":"admin","password":"hunter2-hunter2"}`
	w := authDo(r, authReq{method: "POST", path: "/api/auth/setup", body: creds})
	if w.Code != http.StatusNoContent {
		t.Fatalf("setup: %d %s", w.Code, w.Body)
	}
	setup := w.Result().Cookies()
	assertIndependentCSRF(t, setup, "setup")

	w = authDo(r, authReq{method: "POST", path: "/api/auth/login", body: creds})
	login := w.Result().Cookies()
	assertIndependentCSRF(t, login, "login")
	if cookieNamed(login, csrfCookieName) == cookieNamed(setup, csrfCookieName) {
		t.Fatal("two logins must not share a CSRF value")
	}
}

func TestTwoFactorLoginIssuesIndependentCSRF(t *testing.T) {
	e := newAuthTestEnv(t)
	_, token := setupAndLogin(t, e.r)
	secret, _ := e.enable2FA(t, token)
	ch := e.challenge(t, false)
	w := e.login2fa(`{"challengeToken":"`+ch+`","code":"`+e.currentCode(t, secret)+`"}`, false)
	if w.Code != http.StatusNoContent {
		t.Fatalf("web 2fa: %d %s", w.Code, w.Body)
	}
	assertIndependentCSRF(t, w.Result().Cookies(), "login/2fa")
}

func TestCSRFHeaderStillEnforced(t *testing.T) {
	r := newAuthTestRouter(t)
	cookies, _ := setupAndLogin(t, r)
	csrf := cookieNamed(cookies, csrfCookieName)
	session := cookieNamed(cookies, sessionCookieName)

	for name, hdr := range map[string]map[string]string{
		"missing":              nil,
		"wrong":                {"X-CSRF-Token": "nope"},
		"the session token":    {"X-CSRF-Token": session},
		"a truncated real one": {"X-CSRF-Token": csrf[:32]},
		"real one plus a tail": {"X-CSRF-Token": csrf + "00"},
		"empty":                {"X-CSRF-Token": ""},
	} {
		if w := authDo(r, authReq{method: "POST", path: "/api/thing", cookies: cookies, headers: hdr}); w.Code != http.StatusForbidden {
			t.Fatalf("%s header: expected 403, got %d", name, w.Code)
		}
	}
	if w := authDo(r, authReq{method: "POST", path: "/api/thing", cookies: cookies, headers: map[string]string{"X-CSRF-Token": csrf}}); w.Code != http.StatusNoContent {
		t.Fatalf("matching header: expected 204, got %d", w.Code)
	}
}

// The CSRF value is only a double-submit token: it must not work as a credential anywhere.
func TestCSRFValueIsNotACredential(t *testing.T) {
	r := newAuthTestRouter(t)
	cookies, _ := setupAndLogin(t, r)
	csrf := cookieNamed(cookies, csrfCookieName)
	if w := authDo(r, authReq{method: "GET", path: "/api/thing", headers: map[string]string{"Authorization": "Bearer " + csrf}}); w.Code != http.StatusUnauthorized {
		t.Fatalf("CSRF value as bearer: expected 401, got %d", w.Code)
	}
	if w := authDo(r, authReq{method: "GET", path: "/api/thing?token=" + csrf}); w.Code != http.StatusUnauthorized {
		t.Fatalf("CSRF value as ?token=: expected 401, got %d", w.Code)
	}
}

// Sessions from before the fix have packrat_csrf == packrat_session in the browser. The first
// cookie-authenticated GET swaps it for a random value; nothing else does.
func TestLegacyCSRFCookieIsHealed(t *testing.T) {
	r := newAuthTestRouter(t)
	cookies, bearer := setupAndLogin(t, r)
	session := cookieNamed(cookies, sessionCookieName)
	legacy := []*http.Cookie{{Name: sessionCookieName, Value: session}, {Name: csrfCookieName, Value: session}}

	healed := func(w interface{ Result() *http.Response }) string {
		return cookieNamed(w.Result().Cookies(), csrfCookieName)
	}

	// The old value keeps working for the request that carries it, mutating ones included...
	w := authDo(r, authReq{method: "POST", path: "/api/thing", cookies: legacy, headers: map[string]string{"X-CSRF-Token": session}})
	if w.Code != http.StatusNoContent {
		t.Fatalf("legacy POST with matching header: %d", w.Code)
	}
	// ...and a mutation never rotates the cookie (that would race requests already in flight).
	if h := healed(w); h != "" {
		t.Fatalf("POST must not rotate the CSRF cookie, got %q", h)
	}

	// A request that authenticated by bearer token isn't a cookie session: nothing to heal.
	if h := healed(authDo(r, authReq{method: "GET", path: "/api/thing", cookies: legacy, headers: map[string]string{"Authorization": "Bearer " + bearer}})); h != "" {
		t.Fatalf("bearer request healed the cookie: %q", h)
	}

	// A cookie-authenticated GET heals it.
	w = authDo(r, authReq{method: "GET", path: "/api/thing", cookies: legacy})
	fresh := healed(w)
	if fresh == "" || fresh == session || len(fresh) != 64 {
		t.Fatalf("GET should issue a fresh random CSRF cookie, got %q", fresh)
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == csrfCookieName && (c.HttpOnly || c.MaxAge <= 0 || c.Path != "/" || c.SameSite != http.SameSiteLaxMode) {
			t.Fatalf("healed cookie attributes differ from setCSRFCookie: %+v", c)
		}
	}

	// The healed value works, and the session token no longer does as a CSRF header.
	next := []*http.Cookie{{Name: sessionCookieName, Value: session}, {Name: csrfCookieName, Value: fresh}}
	if w := authDo(r, authReq{method: "POST", path: "/api/thing", cookies: next, headers: map[string]string{"X-CSRF-Token": fresh}}); w.Code != http.StatusNoContent {
		t.Fatalf("POST with healed CSRF: %d", w.Code)
	}
	if w := authDo(r, authReq{method: "POST", path: "/api/thing", cookies: next, headers: map[string]string{"X-CSRF-Token": session}}); w.Code != http.StatusForbidden {
		t.Fatalf("session token as CSRF header after healing: expected 403, got %d", w.Code)
	}
	// Already-independent cookies are left alone.
	if h := healed(authDo(r, authReq{method: "GET", path: "/api/thing", cookies: next})); h != "" {
		t.Fatalf("independent CSRF cookie was rotated: %q", h)
	}
	if h := healed(authDo(r, authReq{method: "GET", path: "/api/thing", cookies: cookies})); h != "" {
		t.Fatalf("fresh login's CSRF cookie was rotated: %q", h)
	}
}

func TestAuthStatusHealsLegacyCSRFCookie(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, _ := setupAndLogin(t, e.r)
	session := cookieNamed(cookies, sessionCookieName)
	legacy := []*http.Cookie{{Name: sessionCookieName, Value: session}, {Name: csrfCookieName, Value: session}}
	w := authDo(e.r, authReq{method: "GET", path: "/api/auth/status", cookies: legacy})
	if w.Code != http.StatusOK {
		t.Fatalf("status: %d", w.Code)
	}
	if fresh := cookieNamed(w.Result().Cookies(), csrfCookieName); fresh == "" || fresh == session {
		t.Fatalf("auth/status should heal a legacy CSRF cookie, got %q", fresh)
	}
	// Unauthenticated callers get nothing set.
	w = authDo(e.r, authReq{method: "GET", path: "/api/auth/status", cookies: []*http.Cookie{{Name: csrfCookieName, Value: "x"}}})
	if len(w.Result().Cookies()) != 0 {
		t.Fatalf("unauthenticated status set cookies: %v", w.Result().Cookies())
	}
}

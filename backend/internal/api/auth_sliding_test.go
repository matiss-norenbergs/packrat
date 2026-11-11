package api

import (
	"net/http"
	"testing"
	"time"

	"packrat/backend/internal/repository"
)

const sqlTime = "2006-01-02 15:04:05"

func (e *authTestEnv) setExpiry(t *testing.T, token string, at time.Time) {
	t.Helper()
	if _, err := e.conn.Exec(`UPDATE sessions SET expires_at = ? WHERE token = ?`,
		at.UTC().Format(sqlTime), repository.HashSessionToken(token)); err != nil {
		t.Fatal(err)
	}
}

func (e *authTestEnv) expiry(t *testing.T, token string) string {
	t.Helper()
	var s string
	if err := e.conn.QueryRow(`SELECT expires_at FROM sessions WHERE token = ?`, repository.HashSessionToken(token)).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func respCookie(w interface{ Result() *http.Response }, name string) *http.Cookie {
	for _, c := range w.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func TestExpirySlidesAndCookiesAreReissued(t *testing.T) {
	e := newAuthTestEnv(t)
	e.users.SetClock(e.clock.now)
	cookies, bearer := setupAndLogin(t, e.r)
	tok := cookieNamed(cookies, sessionCookieName)
	csrf := cookieNamed(cookies, csrfCookieName)

	e.setExpiry(t, tok, e.clock.now().Add(10*24*time.Hour))
	w := authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies})
	if w.Code != http.StatusNoContent {
		t.Fatal(w.Code)
	}
	if got, want := e.expiry(t, tok), e.clock.now().Add(sessionDuration).UTC().Format(sqlTime); got != want {
		t.Fatalf("expiry = %s, want now+30d = %s", got, want)
	}
	sc, cc := respCookie(w, sessionCookieName), respCookie(w, csrfCookieName)
	if sc == nil || sc.Value != tok || sc.MaxAge != int(sessionDuration.Seconds()) || !sc.HttpOnly || sc.Secure || sc.SameSite != http.SameSiteLaxMode || sc.Path != "/" {
		t.Errorf("session cookie not re-issued as at login: %+v", sc)
	}
	if cc == nil || cc.Value != csrf || cc.MaxAge != int(sessionDuration.Seconds()) || cc.HttpOnly || cc.Secure || cc.SameSite != http.SameSiteLaxMode {
		t.Errorf("csrf cookie not re-issued with its own value: %+v", cc)
	}

	// A bearer client is extended server-side but gets no cookies.
	btok := bearer
	e.setExpiry(t, btok, e.clock.now().Add(10*24*time.Hour))
	w = authDo(e.r, authReq{method: "GET", path: "/api/thing", headers: map[string]string{"Authorization": "Bearer " + btok}})
	if w.Code != http.StatusNoContent || len(w.Result().Cookies()) != 0 {
		t.Fatalf("bearer: %d cookies %v", w.Code, w.Result().Cookies())
	}
	if got, want := e.expiry(t, btok), e.clock.now().Add(sessionDuration).UTC().Format(sqlTime); got != want {
		t.Errorf("bearer expiry = %s, want %s", got, want)
	}
}

func TestExpiryWithPlentyLeftIsNotWrittenAndNoCookies(t *testing.T) {
	e := newAuthTestEnv(t)
	e.users.SetClock(e.clock.now)
	cookies, _ := setupAndLogin(t, e.r)
	tok := cookieNamed(cookies, sessionCookieName)
	at := e.clock.now().Add(29*24*time.Hour + 12*time.Hour)
	e.setExpiry(t, tok, at)
	w := authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies})
	if w.Code != http.StatusNoContent {
		t.Fatal(w.Code)
	}
	if got := e.expiry(t, tok); got != at.UTC().Format(sqlTime) {
		t.Errorf("expiry moved to %s with 29.5 days left", got)
	}
	if n := len(w.Result().Cookies()); n != 0 {
		t.Errorf("cookies re-issued without an extension: %v", w.Result().Cookies())
	}
}

func TestExpiredSessionIsNeverRevived(t *testing.T) {
	e := newAuthTestEnv(t)
	e.users.SetClock(e.clock.now)
	cookies, _ := setupAndLogin(t, e.r)
	tok := cookieNamed(cookies, sessionCookieName)
	at := e.clock.now().Add(-time.Second)
	e.setExpiry(t, tok, at)
	w := authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies})
	if w.Code != http.StatusUnauthorized || len(w.Result().Cookies()) != 0 {
		t.Fatalf("expired: %d %v", w.Code, w.Result().Cookies())
	}
	if ext, err := e.users.TouchSession(t.Context(), tok, e.clock.now()); ext || err != nil {
		t.Errorf("TouchSession on an expired session = %v, %v", ext, err)
	}
	if got := e.expiry(t, tok); got != at.UTC().Format(sqlTime) {
		t.Errorf("expired session was revived to %s", got)
	}
}

// last_seen_at throttling still holds with the slide in the same statement: inside the interval
// nothing is written, so nothing is extended either.
func TestSlideRespectsTheTouchInterval(t *testing.T) {
	e := newAuthTestEnv(t)
	e.users.SetClock(e.clock.now)
	cookies, _ := setupAndLogin(t, e.r)
	tok := cookieNamed(cookies, sessionCookieName)
	authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies}) // first touch
	e.clock.advance(30 * time.Second)
	ten := e.clock.now().Add(10 * 24 * time.Hour)
	e.setExpiry(t, tok, ten)
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies}); len(w.Result().Cookies()) != 0 || e.expiry(t, tok) != ten.UTC().Format(sqlTime) {
		t.Fatal("touched inside the interval")
	}
	e.clock.advance(repository.SessionTouchInterval)
	w := authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies})
	if respCookie(w, sessionCookieName) == nil || e.expiry(t, tok) != e.clock.now().Add(sessionDuration).UTC().Format(sqlTime) {
		t.Fatal("not extended after the interval")
	}
}

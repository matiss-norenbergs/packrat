package api

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"testing"
	"time"
)

func (e *authTestEnv) storedTokens(t *testing.T) []string {
	t.Helper()
	rows, err := e.conn.Query(`SELECT token FROM sessions`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// The database holds hex(SHA-256(token)) for both the cookie (web) and the bearer (desktop) login,
// and every way of presenting the raw token still authenticates.
func TestSessionTokensAreHashedAtRestAndAllTransportsStillWork(t *testing.T) {
	e := newAuthTestEnv(t)
	cookies, bearer := setupAndLogin(t, e.r)
	cookieTok := cookieNamed(cookies, sessionCookieName)

	stored := map[string]bool{}
	for _, s := range e.storedTokens(t) {
		stored[s] = true
	}
	if len(stored) < 2 || !stored[sha256Hex(cookieTok)] || !stored[sha256Hex(bearer)] || stored[cookieTok] || stored[bearer] {
		t.Fatalf("stored tokens %v: want exactly the SHA-256 hex of the cookie and bearer tokens, never the raw values", stored)
	}

	for tok := range stored {
		if len(tok) != 64 {
			t.Errorf("stored token %q is not a 64-char hash", tok)
		}
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies}); w.Code != http.StatusNoContent {
		t.Errorf("cookie auth: %d", w.Code)
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", headers: map[string]string{"Authorization": "Bearer " + bearer}}); w.Code != http.StatusNoContent {
		t.Errorf("bearer auth: %d", w.Code)
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing?token=" + bearer}); w.Code != http.StatusNoContent {
		t.Errorf("?token= auth: %d", w.Code)
	}
	// The stored hash is not a credential.
	h := sha256Hex(bearer)
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", headers: map[string]string{"Authorization": "Bearer " + h}}); w.Code != http.StatusUnauthorized {
		t.Errorf("a stored hash authenticated: %d", w.Code)
	}

	// The list marks the session making the request, found through the hash.
	for _, q := range []authReq{{cookies: cookies}, {headers: map[string]string{"Authorization": "Bearer " + bearer}}} {
		cur := 0
		for _, s := range e.listSessions(t, q) {
			if s.Current {
				cur++
			}
		}
		if cur != 1 {
			t.Errorf("%d sessions marked current, want 1", cur)
		}
	}

	// Revoke-others keeps the caller's session; logout deletes it.
	if w := authDo(e.r, authReq{method: "POST", path: "/api/auth/sessions/revoke-others", cookies: cookies, headers: csrfHeaders(cookies), body: `{}`}); w.Code != http.StatusOK && w.Code != http.StatusNoContent {
		t.Fatalf("revoke-others: %d %s", w.Code, w.Body)
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", headers: map[string]string{"Authorization": "Bearer " + bearer}}); w.Code != http.StatusUnauthorized {
		t.Errorf("revoked bearer still works: %d", w.Code)
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies}); w.Code != http.StatusNoContent {
		t.Errorf("the caller's own session was revoked: %d", w.Code)
	}
	if w := authDo(e.r, authReq{method: "POST", path: "/api/auth/logout", cookies: cookies, headers: csrfHeaders(cookies)}); w.Code != http.StatusNoContent {
		t.Fatalf("logout: %d", w.Code)
	}
	if w := authDo(e.r, authReq{method: "GET", path: "/api/thing", cookies: cookies}); w.Code != http.StatusUnauthorized {
		t.Errorf("session survived logout: %d", w.Code)
	}
	if left := e.storedTokens(t); len(left) != 0 {
		t.Errorf("rows left after logout: %v", left)
	}
}

// A row holding a raw token (someone storing plaintext again, or an old row) never authenticates.
func TestPlaintextSessionRowDoesNotAuthenticate(t *testing.T) {
	e := newAuthTestEnv(t)
	setupAndLogin(t, e.r)
	raw := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	if _, err := e.conn.Exec(`INSERT INTO sessions (token, user_id, expires_at, public_id) VALUES (?, 1, ?, 'rawrow')`,
		raw, e.clock.now().Add(time.Hour).UTC().Format("2006-01-02 15:04:05")); err != nil {
		t.Fatal(err)
	}
	for _, q := range []authReq{
		{method: "GET", path: "/api/thing", headers: map[string]string{"Authorization": "Bearer " + raw}},
		{method: "GET", path: "/api/thing?token=" + raw},
		{method: "GET", path: "/api/thing", cookies: []*http.Cookie{{Name: sessionCookieName, Value: raw}}},
	} {
		if w := authDo(e.r, q); w.Code != http.StatusUnauthorized {
			t.Errorf("plaintext row authenticated via %+v: %d", q, w.Code)
		}
	}
}

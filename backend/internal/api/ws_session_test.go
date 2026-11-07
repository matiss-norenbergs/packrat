package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"packrat/backend/internal/ws"
)

// wsEnv is the auth test env with a live /ws route behind RequireAuth, wired the way main does.
type wsEnv struct {
	*authTestEnv
	srv *httptest.Server
}

func newWSEnv(t *testing.T) *wsEnv {
	t.Helper()
	e := newAuthTestEnv(t)
	hub := ws.NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	go hub.Run(ctx)
	t.Cleanup(cancel)
	hub.SetSessionChecker(func(ctx context.Context, token string) bool {
		_, err := e.users.GetValidSession(ctx, token)
		return err == nil
	})
	e.users.SetOnSessionsRevoked(hub.RevalidateSessions)
	e.r.GET("/ws", RequireAuth(e.users), hub.GinHandler())
	srv := httptest.NewServer(e.r)
	t.Cleanup(srv.Close)
	return &wsEnv{authTestEnv: e, srv: srv}
}

func (e *wsEnv) dial(t *testing.T, cookies []*http.Cookie, queryToken string) *wsWatch {
	t.Helper()
	u := "ws" + strings.TrimPrefix(e.srv.URL, "http") + "/ws"
	if queryToken != "" {
		u += "?token=" + queryToken // the desktop client's form
	}
	h := http.Header{}
	for _, c := range cookies {
		h.Add("Cookie", c.Name+"="+c.Value)
	}
	conn, _, err := websocket.DefaultDialer.Dial(u, h)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	w := &wsWatch{done: make(chan struct{})}
	go func() {
		defer close(w.done)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
	return w
}

// wsWatch reads a connection until the server closes it. (A timed-out read poisons a gorilla
// connection, so "still open" is observed by the reader not having ended, never by a deadline.)
type wsWatch struct{ done chan struct{} }

func wsClosed(w *wsWatch, d time.Duration) bool {
	select {
	case <-w.done:
		return true
	case <-time.After(d):
		return false
	}
}

func TestChangePasswordClosesTheOtherSessionsSocket(t *testing.T) {
	e := newWSEnv(t)
	_, desktopToken := setupAndLogin(t, e.r)
	cookies := e.webLogin(t, "10.0.0.2:1", webUA)

	desktop := e.dial(t, nil, desktopToken) // ?token= connection must still work
	web := e.dial(t, cookies, "")

	w := authDo(e.r, authReq{method: "PATCH", path: "/api/auth/password", cookies: cookies,
		headers: csrfHeaders(cookies),
		body:    `{"currentPassword":"hunter2-hunter2","newPassword":"another-long-pass"}`})
	if w.Code != http.StatusNoContent {
		t.Fatalf("change password: %d %s", w.Code, w.Body)
	}
	if !wsClosed(desktop, 3*time.Second) {
		t.Fatal("the signed-out session's live connection must close")
	}
	if wsClosed(web, 300*time.Millisecond) {
		t.Fatal("the current session's connection must stay open")
	}
}

func TestLogoutClosesThatSessionsSocket(t *testing.T) {
	e := newWSEnv(t)
	cookies, desktopToken := setupAndLogin(t, e.r)
	desktop := e.dial(t, nil, desktopToken)
	web := e.dial(t, cookies, "")

	w := authDo(e.r, authReq{method: "POST", path: "/api/auth/logout", headers: map[string]string{"Authorization": "Bearer " + desktopToken}})
	if w.Code != http.StatusNoContent {
		t.Fatalf("logout: %d %s", w.Code, w.Body)
	}
	if !wsClosed(desktop, 3*time.Second) {
		t.Fatal("logout must close the connection")
	}
	if wsClosed(web, 300*time.Millisecond) {
		t.Fatal("other sessions stay connected")
	}
}

func TestRevokeSessionAndSignOutOthersCloseSockets(t *testing.T) {
	e := newWSEnv(t)
	cookies, desktopToken := setupAndLogin(t, e.r)
	other := e.webLogin(t, "10.0.0.3:1", webUA)
	desktop := e.dial(t, nil, desktopToken)
	otherWS := e.dial(t, other, "")
	web := e.dial(t, cookies, "")

	// Revoke the desktop session by its public id.
	var desktopID string
	for _, s := range e.listSessions(t, authReq{cookies: cookies}) {
		if s.Client == "desktop" {
			desktopID = s.ID
		}
	}
	if desktopID == "" {
		t.Fatal("desktop session not listed")
	}
	w := authDo(e.r, authReq{method: "DELETE", path: "/api/auth/sessions/" + desktopID, cookies: cookies, headers: csrfHeaders(cookies)})
	if w.Code != http.StatusNoContent {
		t.Fatalf("revoke: %d %s", w.Code, w.Body)
	}
	if !wsClosed(desktop, 3*time.Second) {
		t.Fatal("revoking a session must close its connection")
	}
	if wsClosed(otherWS, 200*time.Millisecond) || wsClosed(web, 100*time.Millisecond) {
		t.Fatal("unrelated connections must stay open")
	}

	w = authDo(e.r, authReq{method: "POST", path: "/api/auth/sessions/revoke-others", cookies: cookies, headers: csrfHeaders(cookies)})
	if w.Code != http.StatusOK && w.Code != http.StatusNoContent {
		t.Fatalf("revoke others: %d %s", w.Code, w.Body)
	}
	if !wsClosed(otherWS, 3*time.Second) {
		t.Fatal("sign out others must close their connections")
	}
	if wsClosed(web, 300*time.Millisecond) {
		t.Fatal("the current session's connection must stay")
	}
}

func TestSessionRevokedHookFiresOnlyWhenSomethingWasRemoved(t *testing.T) {
	e := newAuthTestEnv(t)
	setupAndLogin(t, e.r)
	n := 0
	e.users.SetOnSessionsRevoked(func() { n++ })
	ctx := context.Background()
	if _, err := e.users.DeleteOtherSessions(ctx, 999, "none"); err != nil || n != 0 {
		t.Fatalf("no sessions removed but hook ran (n=%d, err=%v)", n, err)
	}
	if err := e.users.DeleteSession(ctx, "nonexistent"); err == nil || n != 0 {
		t.Fatalf("missing session: err=%v n=%d", err, n)
	}
	if _, err := e.users.DeleteOtherSessions(ctx, 1, "keep-nothing"); err != nil || n != 1 {
		t.Fatalf("removal must fire the hook once (n=%d, err=%v)", n, err)
	}
}

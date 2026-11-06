package ws

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"packrat/backend/internal/models"
)

// liveSessions is a mutable set of valid tokens standing in for the sessions table.
type liveSessions struct {
	mu sync.Mutex
	m  map[string]bool
}

func (l *liveSessions) set(tok string, ok bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.m[tok] = ok
}

func (l *liveSessions) check(_ context.Context, tok string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.m[tok]
}

func newTestServer(t *testing.T, live *liveSessions) (*Hub, *httptest.Server) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	hub := NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	go hub.Run(ctx)
	t.Cleanup(cancel)
	hub.SetSessionChecker(live.check)

	r := gin.New()
	// Stand-in for RequireAuth: the token comes from ?token=, like a desktop client's.
	r.GET("/ws", func(c *gin.Context) {
		if tok := c.Query("token"); tok != "" {
			c.Set(sessionKey, &models.Session{Token: tok})
		}
	}, hub.GinHandler())
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return hub, srv
}

func dial(t *testing.T, srv *httptest.Server, token string) *watch {
	t.Helper()
	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	if token != "" {
		u += "?token=" + token
	}
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	w := &watch{done: make(chan struct{})}
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

// watch reads a connection until the server closes it. (A timed-out read poisons a gorilla
// connection, so "still open" is observed by the reader not having ended.)
type watch struct{ done chan struct{} }

// closed reports whether the server closed the connection within d.
func closed(w *watch, d time.Duration) bool {
	select {
	case <-w.done:
		return true
	case <-time.After(d):
		return false
	}
}

func waitClients(t *testing.T, h *Hub, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		h.Broadcast(Event{}) // round-trips through Run, so earlier registrations are visible
		time.Sleep(20 * time.Millisecond)
		if h.count() == want {
			return
		}
	}
	t.Fatalf("hub has %d clients, want %d", h.count(), want)
}

func TestRevalidateClosesOnlyClientsWhoseSessionIsGone(t *testing.T) {
	live := &liveSessions{m: map[string]bool{"a": true, "b": true}}
	hub, srv := newTestServer(t, live)
	a := dial(t, srv, "a")
	a2 := dial(t, srv, "a") // two tabs on one session
	b := dial(t, srv, "b")
	waitClients(t, hub, 3)

	live.set("a", false)
	hub.RevalidateSessions()

	if !closed(a, 2*time.Second) || !closed(a2, 2*time.Second) {
		t.Fatal("connections of the revoked session must be closed")
	}
	if closed(b, 300*time.Millisecond) {
		t.Fatal("another session's connection must stay open")
	}
	waitClients(t, hub, 1)
}

func TestRevalidateWithNoChangeKeepsEveryone(t *testing.T) {
	live := &liveSessions{m: map[string]bool{"a": true}}
	hub, srv := newTestServer(t, live)
	a := dial(t, srv, "a")
	anon := dial(t, srv, "") // carries no session: never closed by the check
	waitClients(t, hub, 2)
	hub.RevalidateSessions()
	if closed(a, 300*time.Millisecond) || closed(anon, 100*time.Millisecond) {
		t.Fatal("nothing was revoked, nothing may close")
	}
}

func TestPingTickClosesAClientWhoseSessionVanished(t *testing.T) {
	old := pingPeriod
	pingPeriod = 50 * time.Millisecond
	t.Cleanup(func() { pingPeriod = old })

	live := &liveSessions{m: map[string]bool{"a": true, "b": true}}
	hub, srv := newTestServer(t, live)
	a := dial(t, srv, "a")
	b := dial(t, srv, "b")
	waitClients(t, hub, 2)

	// No RevalidateSessions call: the safety net on the ping tick finds it on its own.
	live.set("a", false)
	if !closed(a, 3*time.Second) {
		t.Fatal("the tick must close a client whose session is gone")
	}
	if closed(b, 300*time.Millisecond) {
		t.Fatal("a client with a live session must stay")
	}
}

func TestNoCheckerMeansNoClosing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	hub := NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)
	r := gin.New()
	r.GET("/ws", func(c *gin.Context) { c.Set(sessionKey, &models.Session{Token: "x"}) }, hub.GinHandler())
	srv := httptest.NewServer(r)
	defer srv.Close()
	conn := dial(t, srv, "")
	hub.RevalidateSessions()
	if closed(conn, 300*time.Millisecond) {
		t.Fatal("without a checker every session counts as valid")
	}
}

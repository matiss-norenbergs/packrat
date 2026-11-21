package ws

import (
	"context"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func newPlainServer(t *testing.T, ctx context.Context) (*Hub, *httptest.Server) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	hub := NewHub()
	go hub.Run(ctx)
	r := gin.New()
	r.GET("/ws", hub.GinHandler())
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return hub, srv
}

func dialRaw(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func readPumps() int {
	buf := make([]byte, 1<<20)
	buf = buf[:runtime.Stack(buf, true)]
	return strings.Count(string(buf), "(*Client).readPump")
}

func TestOversizedMessageDisconnectsAndHubStaysHealthy(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	hub, srv := newPlainServer(t, ctx)

	big := dialRaw(t, srv)
	waitFor(t, "registration", func() bool { return hub.count() == 1 })
	if err := big.WriteMessage(websocket.TextMessage, []byte(strings.Repeat("x", maxReadBytes+1))); err != nil {
		t.Fatal(err)
	}
	big.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		if _, _, err := big.ReadMessage(); err != nil {
			break // closed by the server (a read timeout would also land here; the count check below catches that)
		}
	}
	waitFor(t, "oversized client to be unregistered", func() bool { return hub.count() == 0 })

	// The hub still serves a normal client, which can send a message at the limit.
	ok := dialRaw(t, srv)
	waitFor(t, "second registration", func() bool { return hub.count() == 1 })
	if err := ok.WriteMessage(websocket.TextMessage, []byte(strings.Repeat("x", maxReadBytes))); err != nil {
		t.Fatal(err)
	}
	hub.Broadcast(Event{Type: "ping"})
	ok.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, _, err := ok.ReadMessage(); err != nil {
		t.Fatalf("healthy client got no broadcast: %v", err)
	}
}

func TestShuttingDownTheHubReleasesEveryReadPump(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	hub, srv := newPlainServer(t, ctx)

	// readPumps counts goroutines process-wide, so first let earlier tests' pumps wind down.
	// Registration also happens before the server starts the pump goroutines, so wait for the
	// pumps themselves instead of asserting right after hub.count() reaches n.
	waitFor(t, "earlier tests' readPumps to finish", func() bool { return readPumps() == 0 })
	const n = 5
	for i := 0; i < n; i++ {
		dialRaw(t, srv)
	}
	waitFor(t, "registrations", func() bool { return hub.count() == n })
	waitFor(t, "every client's readPump to be running", func() bool { return readPumps() == n })

	cancel()
	waitFor(t, "every readPump to return after shutdown", func() bool { return readPumps() == 0 })
}

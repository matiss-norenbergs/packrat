package ws

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"packrat/backend/internal/models"
)

// SessionChecker reports whether the session with token still exists and is unexpired.
type SessionChecker func(ctx context.Context, token string) bool

// sessionKey is the gin context key RequireAuth stores the *models.Session under.
const sessionKey = "session"

// clientSendBuffer caps how many unsent messages queue up for a slow
// client before it is dropped, so one stalled browser tab cannot back up
// broadcasts for everyone else.
const clientSendBuffer = 32

type Hub struct {
	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan Event

	// done is closed right before Run returns, once ctx fires — GinHandler
	// selects on it alongside the h.register send so a connection arriving
	// during/after shutdown doesn't block that request goroutine forever on
	// the now-unread register channel.
	done chan struct{}

	// revalidate asks Run to re-check every client's session (buffered 1, so requests coalesce).
	revalidate chan struct{}
	countReq   chan chan int

	checkMu sync.RWMutex
	check   SessionChecker
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan Event, 256),
		done:       make(chan struct{}),
		revalidate: make(chan struct{}, 1),
		countReq:   make(chan chan int),
	}
}

// SetSessionChecker makes the hub close connections whose session no longer exists: right away
// after RevalidateSessions, and as a safety net on every client's ping tick.
func (h *Hub) SetSessionChecker(f SessionChecker) {
	h.checkMu.Lock()
	h.check = f
	h.checkMu.Unlock()
}

// sessionValid is true when no checker is set or the token's session is still live.
func (h *Hub) sessionValid(token string) bool {
	h.checkMu.RLock()
	f := h.check
	h.checkMu.RUnlock()
	if f == nil || token == "" {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return f(ctx, token)
}

// RevalidateSessions closes the clients whose session was removed (call it after logout, session
// revocation or a password change). Non-blocking; the check runs off the hub's goroutine.
func (h *Hub) RevalidateSessions() {
	select {
	case h.revalidate <- struct{}{}:
	default:
	}
}

// closeInvalid closes the given clients whose session is gone. One lookup per distinct token.
func (h *Hub) closeInvalid(clients []*Client) {
	valid := map[string]bool{}
	for _, c := range clients {
		ok, seen := valid[c.token]
		if !seen {
			ok = h.sessionValid(c.token)
			valid[c.token] = ok
		}
		if !ok {
			c.conn.Close() // readPump exits and unregisters the client
		}
	}
}

// Run owns the clients map exclusively, so client (de)registration and
// broadcast fan-out never need a mutex. It blocks until ctx is cancelled.
func (h *Hub) Run(ctx context.Context) {
	defer close(h.done)
	for {
		select {
		case <-ctx.Done():
			for c := range h.clients {
				close(c.send)
			}
			return
		case c := <-h.register:
			h.clients[c] = true
		case c := <-h.unregister:
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send)
			}
		case ch := <-h.countReq:
			ch <- len(h.clients)
		case <-h.revalidate:
			snapshot := make([]*Client, 0, len(h.clients))
			for c := range h.clients {
				if c.token != "" {
					snapshot = append(snapshot, c)
				}
			}
			if len(snapshot) > 0 {
				go h.closeInvalid(snapshot)
			}
		case e := <-h.broadcast:
			msg := marshalEvent(e)
			if msg == nil {
				continue
			}
			for c := range h.clients {
				select {
				case c.send <- msg:
				default:
					// Slow consumer; drop it rather than blocking every
					// other client's broadcasts.
					delete(h.clients, c)
					close(c.send)
				}
			}
		}
	}
}

// Broadcast queues e for delivery to all connected clients. Non-blocking:
// if the hub's internal buffer is full (Run is somehow wedged), the event
// is dropped rather than stalling the caller — WS is a live-delta channel
// only, and the frontend resyncs via REST on reconnect.
func (h *Hub) Broadcast(e Event) {
	select {
	case h.broadcast <- e:
	default:
		log.Printf("ws: broadcast buffer full, dropping event %v", e.Type)
	}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true }, // local-network, no-auth app this pass
}

// GinHandler returns the /ws route handler that upgrades the connection and
// registers a Client with the hub.
func (h *Hub) GinHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Printf("ws: upgrade failed: %v", err)
			return
		}

		client := &Client{hub: h, conn: conn, send: make(chan []byte, clientSendBuffer)}
		// Bind the connection to the session that opened it (cookie, bearer or ?token=), so
		// revoking that session closes it.
		if v, ok := c.Get(sessionKey); ok {
			if sess, ok := v.(*models.Session); ok {
				client.token = sess.Token
			}
		}
		select {
		case h.register <- client:
			go client.writePump()
			go client.readPump()
		case <-h.done:
			// Hub.Run has stopped reading h.register (shutting down) — close
			// the freshly-upgraded connection instead of blocking forever.
			conn.Close()
		}
	}
}

// count is the number of registered clients (tests).
func (h *Hub) count() int {
	ch := make(chan int, 1)
	select {
	case h.countReq <- ch:
		return <-ch
	case <-h.done:
		return 0
	}
}

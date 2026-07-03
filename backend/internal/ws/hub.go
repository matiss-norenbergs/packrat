package ws

import (
	"context"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// clientSendBuffer caps how many unsent messages queue up for a slow
// client before it is dropped, so one stalled browser tab cannot back up
// broadcasts for everyone else.
const clientSendBuffer = 32

type Hub struct {
	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan Event
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan Event, 256),
	}
}

// Run owns the clients map exclusively, so client (de)registration and
// broadcast fan-out never need a mutex. It blocks until ctx is cancelled.
func (h *Hub) Run(ctx context.Context) {
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
		h.register <- client

		go client.writePump()
		go client.readPump()
	}
}

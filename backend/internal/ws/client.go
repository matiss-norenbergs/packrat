package ws

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait = 10 * time.Second
	pongWait  = 60 * time.Second

	// maxReadBytes caps an inbound message. Clients never send anything meaningful (readPump only
	// detects disconnects; pongs are control frames of at most 125 bytes), so a few KiB is far
	// more than needed and an oversized message closes the connection instead of being buffered.
	maxReadBytes = 4096
)

// pingPeriod is how often a client is pinged (and its session re-checked); a var so tests can
// shorten it.
var pingPeriod = (pongWait * 9) / 10

// Client wraps one connected WebSocket peer. Packrat's clients are
// broadcast-only consumers this pass — readPump exists solely to detect
// disconnects and keep the connection alive via ping/pong, not to accept
// inbound commands.
type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
	// token is the session this connection was opened with ("" when it carries none); the hub
	// closes the connection once that session is gone.
	token string
}

func (c *Client) readPump() {
	defer func() {
		// Once the hub has stopped nobody reads unregister, so don't block on it.
		select {
		case c.hub.unregister <- c:
		case <-c.hub.done:
		}
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxReadBytes)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			if !c.hub.sessionValid(c.token) {
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func marshalEvent(e Event) []byte {
	b, err := json.Marshal(e)
	if err != nil {
		log.Printf("ws: failed to marshal event %v: %v", e.Type, err)
		return nil
	}
	return b
}

import { websocketUrl } from "@/lib/server"
import type { WSEvent } from "@/types/ws"

export function connectDownloadsSocket(onMessage: (event: WSEvent) => void): WebSocket {
  const socket = new WebSocket(websocketUrl())

  socket.addEventListener("message", (ev) => {
    let parsed: WSEvent
    try {
      parsed = JSON.parse(ev.data) as WSEvent
    } catch {
      return // ignore malformed frames
    }
    // A throwing handler must not vanish silently (nor stop later events): log the event type only,
    // never the payload.
    try {
      onMessage(parsed)
    } catch (err) {
      console.error(`WebSocket handler failed for "${String(parsed?.type)}" event`, err)
    }
  })

  return socket
}

import { websocketUrl } from "@/lib/server"
import type { WSEvent } from "@/types/ws"

export function connectDownloadsSocket(onMessage: (event: WSEvent) => void): WebSocket {
  const socket = new WebSocket(websocketUrl())

  socket.addEventListener("message", (ev) => {
    try {
      const parsed = JSON.parse(ev.data) as WSEvent
      onMessage(parsed)
    } catch {
      // ignore malformed frames
    }
  })

  return socket
}

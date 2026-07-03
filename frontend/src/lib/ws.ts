import type { WSEvent } from "@/types/ws"

export function connectDownloadsSocket(onMessage: (event: WSEvent) => void): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`)

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

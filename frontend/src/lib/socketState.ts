import { useSyncExternalStore } from "react"

// Whether the shared downloads WebSocket is currently open. While it is, its events keep the
// downloads data fresh, so the safety-net polling can stand down; it comes back the moment the
// socket drops. Written only by useDownloadsSocket.
let open = false
const listeners = new Set<() => void>()

export function setSocketOpen(next: boolean) {
  if (open === next) return
  open = next
  listeners.forEach((l) => l())
}

export function isSocketOpen(): boolean {
  return open
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSocketOpen(): boolean {
  return useSyncExternalStore(subscribe, isSocketOpen, () => false)
}

/** `refetchInterval` for a safety-net poll: `ms` only while the socket is not delivering events. */
export function pollWhileSocketDown(ms: number, socketOpen: boolean): number | false {
  return socketOpen ? false : ms
}

import { queryClient } from "@/lib/queryClient"
import { getServerUrl, isDesktop, probeServer } from "@/lib/server"

// Desktop only: tracks whether the server is currently reachable, so the app can say "reconnecting"
// instead of just failing requests one by one. A failed request (or a dropped WebSocket) is only a
// hint — it is checked against /api/health before the banner appears, so a single odd failure
// doesn't flash it — and while offline the server is re-probed until it answers.
const PROBE_INTERVAL_MS = 5000

let offline = false
let verifying = false
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isOffline(): boolean {
  return offline
}

function stopProbing() {
  if (timer) clearInterval(timer)
  timer = null
}

function setOffline(next: boolean) {
  if (offline === next) return
  offline = next
  listeners.forEach((listener) => listener())
  // Everything cached while the server was away may be stale — refetch what's on screen.
  if (!next) void queryClient.invalidateQueries()
}

async function serverAnswers(): Promise<boolean> {
  const url = getServerUrl()
  return url ? (await probeServer(url)).ok : true
}

// Called when a request failed at the network level or the WebSocket dropped.
export async function reportNetworkFailure(): Promise<void> {
  if (!isDesktop() || offline || verifying) return
  verifying = true
  try {
    if (await serverAnswers()) return
    setOffline(true)
    timer = setInterval(() => void retryNow(), PROBE_INTERVAL_MS)
  } finally {
    verifying = false
  }
}

// Called whenever the server answered something (any HTTP response, or the socket opening).
export function reportReachable() {
  if (!offline) return
  stopProbing()
  setOffline(false)
}

// The banner's "Retry now" button, and the periodic probe.
export async function retryNow(): Promise<void> {
  if (await serverAnswers()) reportReachable()
}

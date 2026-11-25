import type { QueryClient } from "@tanstack/react-query"
import { authStatusQueryKey, markLoggedOut } from "@/hooks/useAuth"
import { fetchAuthStatus } from "@/lib/api"
import type { AuthStatus } from "@/types/api"

// A revoked session closes the WebSocket and every reconnect fails, but on an idle page no REST
// request is in flight to see the 401. After a socket drop the page asks the server once whether it
// is still signed in; this is the most often it does so.
export const AUTH_RECHECK_INTERVAL_MS = 30_000

const lastCheck = new WeakMap<QueryClient, number>()

// Re-reads the auth status when the page believes it is signed in, at most once per
// AUTH_RECHECK_INTERVAL_MS and never while the tab is hidden. A "not authenticated" answer takes the
// app to the login screen exactly like a logout (the desktop's fetchAuthStatus also drops its dead
// token). Failures (server down) are ignored: the connection monitor and the socket's own
// reconnects cover those.
export async function recheckAuthAfterSocketDrop(queryClient: QueryClient, now: number = Date.now()): Promise<void> {
  if (document.hidden) return
  if (queryClient.getQueryData<AuthStatus>(authStatusQueryKey)?.authenticated !== true) return
  const last = lastCheck.get(queryClient)
  if (last !== undefined && now - last < AUTH_RECHECK_INTERVAL_MS) return
  lastCheck.set(queryClient, now)
  try {
    const status = await fetchAuthStatus()
    if (!status.authenticated) markLoggedOut(queryClient)
  } catch {
    // unreachable or erroring server: not a verdict on the session
  }
}

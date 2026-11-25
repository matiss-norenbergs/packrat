import type { QueryClient, QueryKey } from "@tanstack/react-query"
import { collectionsQueryKey, libraryQueryKey } from "@/lib/queryKeys"

/**
 * Coalesced, visibility-aware invalidation for events that arrive in bursts (WebSocket events,
 * library mutations). Many requests inside one window turn into one `invalidateQueries` per key
 * group, with `refetchType: "active"` so only what is on screen refetches (the rest is just marked
 * stale and refetches when it is next used).
 *
 * - `schedule(keys)`: trailing window — the first call arms a timer and everything requested until
 *   it fires is flushed together, so the last event always lands within `WINDOW_MS`.
 * - `flushNow(keys)`: for the user's own mutations, which must show up at once; also flushes
 *   whatever was already pending, so nothing is invalidated twice.
 * - While the tab is hidden nothing refetches: the keys are remembered and flushed once when the
 *   tab becomes visible again.
 */
export const INVALIDATION_WINDOW_MS = 1500

export interface InvalidationScheduler {
  schedule(keys: readonly QueryKey[]): void
  flushNow(keys?: readonly QueryKey[]): void
  /** Drops pending work and listeners (tests, unmount). */
  dispose(): void
}

export function createInvalidationScheduler(
  queryClient: QueryClient,
  windowMs = INVALIDATION_WINDOW_MS,
): InvalidationScheduler {
  const pending = new Map<string, QueryKey>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let listening = false

  const hidden = () => typeof document !== "undefined" && document.hidden

  const onVisibility = () => {
    if (!hidden()) flush()
  }
  const stopListening = () => {
    if (!listening) return
    listening = false
    document.removeEventListener("visibilitychange", onVisibility)
  }
  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function flush() {
    clearTimer()
    if (hidden()) {
      // Still hidden (e.g. the window elapsed while the tab was in the background): wait for it.
      if (pending.size > 0 && !listening) {
        listening = true
        document.addEventListener("visibilitychange", onVisibility)
      }
      return
    }
    stopListening()
    const keys = [...pending.values()]
    pending.clear()
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey, refetchType: "active" })
  }

  function add(keys: readonly QueryKey[]) {
    for (const key of keys) pending.set(JSON.stringify(key), key)
  }

  return {
    schedule(keys) {
      add(keys)
      if (hidden()) {
        clearTimer()
        flush() // registers the visibility listener
        return
      }
      if (!timer) timer = setTimeout(flush, windowMs)
    },
    flushNow(keys = []) {
      add(keys)
      flush()
    },
    dispose() {
      clearTimer()
      stopListening()
      pending.clear()
    },
  }
}

const schedulers = new WeakMap<QueryClient, InvalidationScheduler>()

/** The one scheduler for a client — socket events and mutations share it so they coalesce together. */
export function getInvalidationScheduler(queryClient: QueryClient): InvalidationScheduler {
  let scheduler = schedulers.get(queryClient)
  if (!scheduler) {
    scheduler = createInvalidationScheduler(queryClient)
    schedulers.set(queryClient, scheduler)
  }
  return scheduler
}

/**
 * The library's content changed (items added, removed, moved, ghosted…): refresh the library queries
 * and the collections (their item counts and "has items" flags are derived from the library).
 * By default it runs at once (the user's own mutations); socket events pass `coalesce: true`.
 */
export function invalidateLibraryContent(queryClient: QueryClient, options?: { coalesce?: boolean }) {
  const scheduler = getInvalidationScheduler(queryClient)
  const keys = [libraryQueryKey, collectionsQueryKey]
  if (options?.coalesce) scheduler.schedule(keys)
  else scheduler.flushNow(keys)
}

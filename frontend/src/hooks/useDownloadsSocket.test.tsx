import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { INVALIDATION_WINDOW_MS } from "@/lib/queryInvalidation"
import { collectionsQueryKey } from "@/lib/queryKeys"
import type { WSEvent } from "@/types/ws"
import { downloadPreviewQueryKey, downloadsQueryKey } from "./useDownloads"
import { libraryMetadataPreviewQueryKey, libraryQueryKey } from "./useLibrary"
import { useDownloadsSocket } from "./useDownloadsSocket"

let emit: (e: WSEvent) => void = () => {}
let openSocket: () => void = () => {}

vi.mock("@/lib/ws", () => ({
  connectDownloadsSocket: (onEvent: (e: WSEvent) => void) => {
    emit = onEvent
    return {
      addEventListener: (type: string, fn: () => void) => {
        if (type === "open") openSocket = fn
      },
      close: () => {},
    }
  },
}))
vi.mock("@/lib/notify", () => ({
  notifyDesktop: vi.fn(),
  notifyDesktopAsync: vi.fn(),
  notifyEvent: vi.fn(),
  notifyEventAsync: vi.fn(),
}))
vi.mock("@/lib/connection", () => ({ reportNetworkFailure: vi.fn(), reportReachable: vi.fn() }))

let client: QueryClient
let invalidate: ReturnType<typeof vi.spyOn>
const flush = () => vi.advanceTimersByTime(INVALIDATION_WINDOW_MS)
const invalidatedKeys = () => invalidate.mock.calls.map((c: unknown[]) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event("visibilitychange"))
}

beforeEach(() => {
  vi.useFakeTimers()
  setHidden(false)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  invalidate = vi.spyOn(client, "invalidateQueries")
  renderHook(() => useDownloadsSocket(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
})
afterEach(() => {
  cleanup()
  setHidden(false)
  vi.useRealTimers()
})

describe("useDownloadsSocket library refresh", () => {
  it.each<[string, WSEvent]>([
    ["library_changed (ghost created)", { type: "library_changed", payload: { libraryId: 1, reason: "ghost_created" } }],
    ["library_changed (ghost removed)", { type: "library_changed", payload: { libraryId: 1, reason: "ghost_removed" } }],
    ["completed", { type: "completed", payload: { downloadId: 1, libraryId: 1, title: "t" } }],
    ["failed", { type: "failed", payload: { downloadId: 1, status: "failed", error: "boom" } }],
    ["cancelled", { type: "failed", payload: { downloadId: 1, status: "cancelled", error: "cancelled by user" } }],
    ["subscription_new_items", { type: "subscription_new_items", payload: { subscriptionId: 1, subscriptionTitle: "s", newCount: 2 } }],
  ])("invalidates the library and the collections (active only) on %s", (_name, event) => {
    emit(event)
    flush()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: libraryQueryKey, refetchType: "active" })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: collectionsQueryKey, refetchType: "active" })
  })

  it("does not touch the library on a plain queue update", () => {
    emit({ type: "queue_update", payload: { active: 1, queued: 0 } })
    flush()
    expect(invalidatedKeys()).toEqual([JSON.stringify(downloadsQueryKey)])
  })

  it("coalesces a burst of events into one invalidation per key group, the last one landing", () => {
    for (let i = 0; i < 20; i++) {
      emit({ type: "library_changed", payload: { libraryId: i, reason: "ghost_created" } })
      emit({ type: "queue_update", payload: { active: 1, queued: 0 } })
      vi.advanceTimersByTime(50)
    }
    expect(invalidate).not.toHaveBeenCalled()
    flush()
    expect(invalidatedKeys().sort()).toEqual(
      [JSON.stringify(downloadsQueryKey), JSON.stringify(libraryQueryKey), JSON.stringify(collectionsQueryKey)].sort(),
    )
  })

  it("coalesces the refetch on (re)connect too", () => {
    openSocket()
    openSocket()
    expect(invalidate).not.toHaveBeenCalled()
    flush()
    expect(invalidatedKeys().sort()).toEqual(
      [JSON.stringify(downloadsQueryKey), JSON.stringify(libraryQueryKey), JSON.stringify(collectionsQueryKey)].sort(),
    )
  })

  it("does nothing while the tab is hidden, then refreshes once when it is visible again", () => {
    setHidden(true)
    for (let i = 0; i < 5; i++) emit({ type: "completed", payload: { downloadId: i, libraryId: i, title: "t" } })
    vi.advanceTimersByTime(60_000)
    expect(invalidate).not.toHaveBeenCalled()
    setHidden(false)
    expect(invalidatedKeys()).toHaveLength(3)
  })
})

describe("useDownloadsSocket and the yt-dlp previews", () => {
  it("refetches a normal library list on every event type but never a preview", async () => {
    vi.useRealTimers()
    const calls = { preview: 0, metadata: 0, list: 0 }
    const mount = async (queryKey: readonly unknown[], counter: keyof typeof calls) => {
      const queryFn = () => Promise.resolve(++calls[counter])
      await client.getQueryCache().build(client, { queryKey, queryFn }).fetch()
      client.getQueryCache().find({ queryKey })!.addObserver({ onQueryUpdate() {}, options: { queryKey, queryFn }, getCurrentResult() {} } as never)
    }
    await mount(downloadPreviewQueryKey("https://example.com/v"), "preview")
    await mount(libraryMetadataPreviewQueryKey(3), "metadata")
    await mount([...libraryQueryKey, "query", {}], "list")
    invalidate.mockRestore()

    const events: WSEvent[] = [
      { type: "queue_update", payload: { active: 1, queued: 0 } },
      { type: "completed", payload: { downloadId: 1, libraryId: 1, title: "t" } },
      { type: "failed", payload: { downloadId: 2, status: "failed", error: "x" } },
      { type: "library_changed", payload: { libraryId: 1, reason: "ghost_created" } },
    ]
    events.forEach(emit)
    openSocket() // reconnect
    await new Promise((r) => setTimeout(r, INVALIDATION_WINDOW_MS + 200))
    await client.isFetching()

    expect(calls.preview).toBe(1)
    expect(calls.metadata).toBe(1)
    expect(calls.list).toBe(2)
  })
})

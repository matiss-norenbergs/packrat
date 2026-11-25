import { QueryClient } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { collectionsQueryKey, libraryQueryKey } from "./queryKeys"
import { createInvalidationScheduler, INVALIDATION_WINDOW_MS, invalidateLibraryContent, type InvalidationScheduler } from "./queryInvalidation"

let client: QueryClient
let scheduler: InvalidationScheduler
let invalidate: ReturnType<typeof vi.spyOn>

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event("visibilitychange"))
}

beforeEach(() => {
  vi.useFakeTimers()
  client = new QueryClient()
  invalidate = vi.spyOn(client, "invalidateQueries")
  scheduler = createInvalidationScheduler(client)
  setHidden(false)
})
afterEach(() => {
  scheduler.dispose()
  setHidden(false)
  vi.useRealTimers()
})

describe("createInvalidationScheduler", () => {
  it("turns a burst into one invalidation per key group, and the last event lands", () => {
    for (let i = 0; i < 20; i++) {
      scheduler.schedule([libraryQueryKey])
      if (i % 2 === 0) scheduler.schedule([["downloads"]])
      vi.advanceTimersByTime(50) // 20 events over 1 s, inside the window
    }
    expect(invalidate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS)
    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: libraryQueryKey, refetchType: "active" })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["downloads"], refetchType: "active" })
    // An event after the flush starts a new window instead of being dropped.
    scheduler.schedule([libraryQueryKey])
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS)
    expect(invalidate).toHaveBeenCalledTimes(3)
  })

  it("flushes a lone event within the window (a terminal event still shows its result)", () => {
    scheduler.schedule([libraryQueryKey])
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS - 1)
    expect(invalidate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it("defers while the tab is hidden and flushes once when it becomes visible", () => {
    setHidden(true)
    for (let i = 0; i < 10; i++) scheduler.schedule([libraryQueryKey])
    vi.advanceTimersByTime(60_000)
    expect(invalidate).not.toHaveBeenCalled()
    setHidden(false)
    expect(invalidate).toHaveBeenCalledTimes(1)
    setHidden(true)
    setHidden(false)
    expect(invalidate).toHaveBeenCalledTimes(1) // nothing pending: nothing to do
  })

  it("keeps waiting when the window elapses while hidden", () => {
    scheduler.schedule([libraryQueryKey])
    setHidden(true)
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS)
    expect(invalidate).not.toHaveBeenCalled()
    setHidden(false)
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it("flushNow runs at once and takes the pending keys with it", () => {
    scheduler.schedule([["downloads"]])
    scheduler.flushNow([libraryQueryKey])
    expect(invalidate).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS * 2)
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it("only refetches active queries; inactive ones are marked stale", async () => {
    vi.useRealTimers()
    const active = vi.fn().mockResolvedValue(1)
    const inactive = vi.fn().mockResolvedValue(1)
    const observe = (queryKey: readonly unknown[], queryFn: () => Promise<number>, observed: boolean) =>
      client.getQueryCache().build(client, { queryKey, queryFn }).fetch().then(() => {
        if (observed) client.getQueryCache().find({ queryKey })!.addObserver({ onQueryUpdate() {}, options: { queryKey, queryFn }, getCurrentResult() {} } as never)
      })
    await observe([...libraryQueryKey, "a"], active, true)
    await observe([...libraryQueryKey, "b"], inactive, false)
    invalidate.mockRestore()
    await client.invalidateQueries({ queryKey: libraryQueryKey, refetchType: "active" })
    expect(active).toHaveBeenCalledTimes(2)
    expect(inactive).toHaveBeenCalledTimes(1)
    expect(client.getQueryCache().find({ queryKey: [...libraryQueryKey, "b"] })!.state.isInvalidated).toBe(true)
  })
})

describe("invalidateLibraryContent", () => {
  it("refreshes the library and the collections together", () => {
    const spy = vi.spyOn(client, "invalidateQueries")
    invalidateLibraryContent(client)
    expect(spy).toHaveBeenCalledWith({ queryKey: libraryQueryKey, refetchType: "active" })
    expect(spy).toHaveBeenCalledWith({ queryKey: collectionsQueryKey, refetchType: "active" })
  })
})

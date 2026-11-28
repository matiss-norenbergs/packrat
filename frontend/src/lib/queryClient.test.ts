import { describe, expect, it, vi } from "vitest"
import { focusManager, QueryObserver } from "@tanstack/react-query"
import { queryClient } from "@/lib/queryClient"

// The defaults every page relies on: data stays fresh for 5 s (so a quick navigation does not refetch) and a tab focus never refetches
// (a socket and explicit invalidation keep the lists current).
describe("queryClient defaults", () => {
  it("sets staleTime to 5 s and no refetch on window focus", () => {
    const defaults = queryClient.getDefaultOptions().queries
    expect(defaults?.staleTime).toBe(5_000)
    expect(defaults?.refetchOnWindowFocus).toBe(false)
  })

  it("a query read again within 5 s is served from the cache, after 5 s it refetches", async () => {
    vi.useFakeTimers()
    const queryFn = vi.fn(async () => "v")
    const key = ["queryClient-test", Math.random()]
    const observe = () => new QueryObserver(queryClient, { queryKey: key, queryFn })
    try {
      await queryClient.fetchQuery({ queryKey: key, queryFn })
      expect(queryFn).toHaveBeenCalledTimes(1)

      let unsubscribe = observe().subscribe(() => {})
      await vi.advanceTimersByTimeAsync(4_999)
      unsubscribe()
      unsubscribe = observe().subscribe(() => {}) // a second page mounting on the same key, still fresh
      await vi.advanceTimersByTimeAsync(0)
      expect(queryFn).toHaveBeenCalledTimes(1)
      unsubscribe()

      await vi.advanceTimersByTimeAsync(1)
      unsubscribe = observe().subscribe(() => {}) // now 5 s old: stale, so mounting refetches
      await vi.advanceTimersByTimeAsync(0)
      expect(queryFn).toHaveBeenCalledTimes(2)
      unsubscribe()
    } finally {
      queryClient.removeQueries({ queryKey: key })
    }
  })

  it("focusing the window does not refetch an active, stale query", async () => {
    vi.useFakeTimers()
    const queryFn = vi.fn(async () => "v")
    const key = ["queryClient-focus-test", Math.random()]
    queryClient.mount() // QueryClientProvider does this in the app: it is what subscribes the cache to focus changes
    const unsubscribe = new QueryObserver(queryClient, { queryKey: key, queryFn }).subscribe(() => {})
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(queryFn).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(60_000) // long stale
      focusManager.setFocused(false)
      focusManager.setFocused(true) // what a tab regaining focus does
      await vi.advanceTimersByTimeAsync(0)
      expect(queryFn).toHaveBeenCalledTimes(1) // the query was 60 s stale, so a focus refetch would have fired by now
    } finally {
      focusManager.setFocused(undefined)
      queryClient.unmount()
      unsubscribe()
      queryClient.removeQueries({ queryKey: key })
    }
  })
})

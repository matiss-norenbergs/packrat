import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { isLibraryItemNotFound, useLibraryItem, useLibraryItemsByIds } from "./useLibrary"

function wrapper() {
  const client = new QueryClient()
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function mockFetch(items: Record<number, object>) {
  const fetchMock = vi.fn(async (url: string) => {
    const id = Number(url.split("/").pop())
    const item = items[id]
    if (!item) return new Response(JSON.stringify({ error: "library item not found" }), { status: 404 })
    return new Response(JSON.stringify(item), { status: 200 })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("useLibraryItem", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("fetches just the one item, not the whole library", async () => {
    const fetchMock = mockFetch({ 7: { id: 7, title: "seven" } })
    const { result } = renderHook(() => useLibraryItem(7), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toEqual({ id: 7, title: "seven" }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("/api/library/7")
  })

  it("reports a missing item as not-found without retrying", async () => {
    const fetchMock = mockFetch({})
    const { result } = renderHook(() => useLibraryItem(99), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(isLibraryItemNotFound(result.current.error)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("useLibraryItemsByIds", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("keeps id order and drops ids that no longer exist", async () => {
    mockFetch({ 3: { id: 3 }, 1: { id: 1 } })
    const { result } = renderHook(() => useLibraryItemsByIds([3, 2, 1]), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items.map((i) => i.id)).toEqual([3, 1])
  })
})

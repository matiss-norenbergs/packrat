import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { mockFetch } from "@/test/mockApi"
import { useHasPrivateContent } from "./useHasPrivateContent"

afterEach(() => vi.unstubAllGlobals())

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function serve(privacy: boolean, artistPrivate: boolean) {
  const fetchMock = mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: privacy } }
    if (url.endsWith("/artists")) return { status: 200, body: [{ id: 1, name: "A", isPrivate: artistPrivate }] }
    return { status: 200, body: [] }
  })
  return fetchMock
}

describe("useHasPrivateContent", () => {
  it("is true for a private artist alone", async () => {
    const fetchMock = serve(true, true)
    const { result } = renderHook(() => useHasPrivateContent(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current).toBe(true))
    expect(fetchMock).toHaveBeenCalled()
  })

  it("is false with privacy off, or with only public artists", async () => {
    serve(false, true)
    const off = renderHook(() => useHasPrivateContent(), { wrapper: wrapper() })
    await new Promise((r) => setTimeout(r, 30))
    expect(off.result.current).toBe(false)
    off.unmount()

    serve(true, false)
    const pub = renderHook(() => useHasPrivateContent(), { wrapper: wrapper() })
    await new Promise((r) => setTimeout(r, 30))
    expect(pub.result.current).toBe(false)
  })
})

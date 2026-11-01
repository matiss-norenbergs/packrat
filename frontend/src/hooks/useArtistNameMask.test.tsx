import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { hashText } from "@/lib/utils"
import { mockFetch } from "@/test/mockApi"
import { maskArtistName, useArtistNameMask } from "./useArtistNameMask"

afterEach(() => vi.unstubAllGlobals())

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe("maskArtistName", () => {
  const priv = new Set([1])
  it("returns the real name with privacy off or when revealed", () => {
    expect(maskArtistName(1, "Secret", false, false, priv)).toBe("Secret")
    expect(maskArtistName(1, "Secret", true, true, priv)).toBe("Secret")
  })
  it("hashes only private artists with privacy on", () => {
    expect(maskArtistName(1, "Secret", false, true, priv)).toBe(hashText("Secret"))
    expect(maskArtistName(2, "Open", false, true, priv)).toBe("Open")
    expect(maskArtistName(null, "Open", false, true, priv)).toBe("Open")
  })
  it("fails closed while settings or artists are unknown", () => {
    expect(maskArtistName(2, "Open", false, undefined, priv)).toBe("Open")
    expect(maskArtistName(1, "Secret", false, undefined, priv)).toBe(hashText("Secret"))
    expect(maskArtistName(2, "Open", false, true, undefined)).toBe(hashText("Open"))
    expect(maskArtistName(2, "Open", false, undefined, undefined)).toBe(hashText("Open"))
  })
})

const artists = [
  { id: 1, name: "Secret", isPrivate: true },
  { id: 2, name: "Open", isPrivate: false },
]

describe("useArtistNameMask", () => {
  it("hashes everything until loaded, then only private artists", async () => {
    mockFetch((url) => {
      if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: true } }
      if (url.endsWith("/artists")) return { status: 200, body: artists }
      return { status: 200, body: {} }
    })
    const { result } = renderHook(() => useArtistNameMask(), { wrapper })
    expect(result.current(2, "Open", false)).toBe(hashText("Open"))
    await waitFor(() => expect(result.current(2, "Open", false)).toBe("Open"))
    expect(result.current(1, "Secret", false)).toBe(hashText("Secret"))
    expect(result.current(1, "Secret", true)).toBe("Secret")
  })

  it("leaves names alone with privacy off", async () => {
    mockFetch((url) => {
      if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: false } }
      if (url.endsWith("/artists")) return { status: 200, body: artists }
      return { status: 200, body: {} }
    })
    const { result } = renderHook(() => useArtistNameMask(), { wrapper })
    await waitFor(() => expect(result.current(1, "Secret", false)).toBe("Secret"))
  })

  it("keeps the same function identity across re-renders (private set memoized)", async () => {
    mockFetch((url) => {
      if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: true } }
      if (url.endsWith("/artists")) return { status: 200, body: artists }
      return { status: 200, body: {} }
    })
    const { result, rerender } = renderHook(() => useArtistNameMask(), { wrapper })
    await waitFor(() => expect(result.current(2, "Open", false)).toBe("Open"))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})

import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { hashText } from "@/lib/utils"
import { mockFetch } from "@/test/mockApi"
import { maskTagName, useTagNameMask } from "./useTagNameMask"

afterEach(() => vi.unstubAllGlobals())

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe("maskTagName", () => {
  const priv = new Set(["Secret"])
  it("returns the real name with privacy off or when revealed", () => {
    expect(maskTagName("Secret", false, false, priv)).toBe("Secret")
    expect(maskTagName("Secret", true, true, priv)).toBe("Secret")
  })
  it("hashes only private tags with privacy on", () => {
    expect(maskTagName("Secret", false, true, priv)).toBe(hashText("Secret"))
    expect(maskTagName("Open", false, true, priv)).toBe("Open")
  })
  it("fails closed while settings or tags are unknown", () => {
    expect(maskTagName("Open", false, undefined, priv)).toBe("Open")
    expect(maskTagName("Secret", false, undefined, priv)).toBe(hashText("Secret"))
    expect(maskTagName("Open", false, true, undefined)).toBe(hashText("Open"))
    expect(maskTagName("Open", false, undefined, undefined)).toBe(hashText("Open"))
  })
})

describe("useTagNameMask", () => {
  it("hashes everything until loaded, then only private tags", async () => {
    mockFetch((url) => {
      if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: true } }
      if (url.endsWith("/tags")) return { status: 200, body: [{ id: 1, name: "Secret", isPrivate: true }, { id: 2, name: "Open", isPrivate: false }] }
      return { status: 200, body: {} }
    })
    const { result } = renderHook(() => useTagNameMask(), { wrapper })
    expect(result.current("Open", false)).toBe(hashText("Open"))
    await waitFor(() => expect(result.current("Open", false)).toBe("Open"))
    expect(result.current("Secret", false)).toBe(hashText("Secret"))
    expect(result.current("Secret", true)).toBe("Secret")
  })

  it("leaves names alone with privacy off", async () => {
    mockFetch((url) => {
      if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: false } }
      if (url.endsWith("/tags")) return { status: 200, body: [{ id: 1, name: "Secret", isPrivate: true }] }
      return { status: 200, body: {} }
    })
    const { result } = renderHook(() => useTagNameMask(), { wrapper })
    await waitFor(() => expect(result.current("Secret", false)).toBe("Secret"))
  })
})

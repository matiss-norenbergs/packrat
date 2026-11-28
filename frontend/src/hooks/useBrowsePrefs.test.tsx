import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BROWSE_AUTOPLAY_KEY, BROWSE_BLUR_PRIVATE_KEY, useBrowsePrefs } from "@/hooks/useBrowsePrefs"
import { mockFetch } from "@/test/mockApi"
import { enterTauri, leaveTauri } from "@/test/tauriShell"

function serverSettings(body: { libraryAutoplay: boolean; browseIgnorePrivacy: boolean }) {
  return mockFetch((url) => (url.endsWith("/settings") ? { status: 200, body } : { status: 404 }))
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

async function renderPrefs() {
  const hook = renderHook(() => useBrowsePrefs(), { wrapper: wrapper() })
  // Settings loaded once the server values (not the loading fallbacks) are reported.
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
  await act(async () => {})
  return hook
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  leaveTauri()
  vi.restoreAllMocks()
})

describe("useBrowsePrefs in the Android app", () => {
  beforeEach(() => enterTauri("android"))

  it("follows the server when no override is set, with blur the inverse of browseIgnorePrivacy", async () => {
    serverSettings({ libraryAutoplay: false, browseIgnorePrivacy: true })
    const { result } = await renderPrefs()
    await waitFor(() => expect(result.current.autoplay).toBe(false))
    expect(result.current.blurPrivate).toBe(false)
    expect(result.current.autoplayOverridden).toBe(false)
    expect(result.current.blurPrivateOverridden).toBe(false)
  })

  it("blurs private items when the server doesn't ignore privacy", async () => {
    serverSettings({ libraryAutoplay: true, browseIgnorePrivacy: false })
    const { result } = await renderPrefs()
    await waitFor(() => expect(result.current.serverBlurPrivate).toBe(true))
    expect(result.current.blurPrivate).toBe(true)
  })

  it("an override wins over the server and reset goes back to following it", async () => {
    serverSettings({ libraryAutoplay: true, browseIgnorePrivacy: false })
    const { result } = await renderPrefs()
    await waitFor(() => expect(result.current.autoplay).toBe(true))

    act(() => result.current.setAutoplay(false))
    expect(result.current.autoplay).toBe(false)
    expect(result.current.autoplayOverridden).toBe(true)
    expect(localStorage.getItem(BROWSE_AUTOPLAY_KEY)).toBe("false")

    act(() => result.current.setBlurPrivate(false))
    expect(result.current.blurPrivate).toBe(false)
    expect(localStorage.getItem(BROWSE_BLUR_PRIVATE_KEY)).toBe("false")

    act(() => result.current.resetAutoplay())
    expect(result.current.autoplay).toBe(true)
    expect(result.current.autoplayOverridden).toBe(false)
    expect(localStorage.getItem(BROWSE_AUTOPLAY_KEY)).toBeNull()

    act(() => result.current.resetBlurPrivate())
    expect(result.current.blurPrivate).toBe(true)
    expect(localStorage.getItem(BROWSE_BLUR_PRIVATE_KEY)).toBeNull()
  })

  it("an override equal to the server value still counts as set on this device", async () => {
    serverSettings({ libraryAutoplay: true, browseIgnorePrivacy: false })
    const { result } = await renderPrefs()
    act(() => result.current.setAutoplay(true))
    expect(result.current.autoplayOverridden).toBe(true)
  })

  it("a change reaches every other user of the hook at once", async () => {
    serverSettings({ libraryAutoplay: true, browseIgnorePrivacy: false })
    const a = await renderPrefs()
    const b = await renderPrefs()
    act(() => a.result.current.setBlurPrivate(false))
    expect(b.result.current.blurPrivate).toBe(false)
  })

  it("picks up a change made in another window (storage event)", async () => {
    serverSettings({ libraryAutoplay: true, browseIgnorePrivacy: false })
    const { result } = await renderPrefs()
    act(() => {
      localStorage.setItem(BROWSE_AUTOPLAY_KEY, "false")
      window.dispatchEvent(new StorageEvent("storage", { key: BROWSE_AUTOPLAY_KEY }))
    })
    expect(result.current.autoplay).toBe(false)
  })

  it("reads a stored override on a fresh mount", async () => {
    localStorage.setItem(BROWSE_BLUR_PRIVATE_KEY, "false")
    serverSettings({ libraryAutoplay: true, browseIgnorePrivacy: false })
    const { result } = await renderPrefs()
    expect(result.current.blurPrivate).toBe(false)
    expect(result.current.blurPrivateOverridden).toBe(true)
  })

  it("ignores a stored value that isn't true/false", async () => {
    localStorage.setItem(BROWSE_AUTOPLAY_KEY, "yes")
    serverSettings({ libraryAutoplay: false, browseIgnorePrivacy: false })
    const { result } = await renderPrefs()
    await waitFor(() => expect(result.current.autoplay).toBe(false))
    expect(result.current.autoplayOverridden).toBe(false)
  })

  it("still works for the session when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied")
    })
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied")
    })
    serverSettings({ libraryAutoplay: true, browseIgnorePrivacy: false })
    const { result } = await renderPrefs()
    expect(result.current.autoplay).toBe(true)
    act(() => result.current.setAutoplay(false))
    expect(result.current.autoplay).toBe(false)
    act(() => result.current.resetAutoplay())
    expect(result.current.autoplay).toBe(true)
  })
})

describe.each([
  ["web", () => {}],
  ["desktop app", () => enterTauri("desktop")],
])("useBrowsePrefs on the %s", (_name, enter) => {
  beforeEach(() => enter())

  it("ignores stored overrides and reads the server settings as before", async () => {
    localStorage.setItem(BROWSE_AUTOPLAY_KEY, "true")
    localStorage.setItem(BROWSE_BLUR_PRIVATE_KEY, "true")
    serverSettings({ libraryAutoplay: false, browseIgnorePrivacy: true })
    const { result } = await renderPrefs()
    await waitFor(() => expect(result.current.autoplay).toBe(false))
    expect(result.current.blurPrivate).toBe(false)
    expect(result.current.autoplayOverridden).toBe(false)
    expect(result.current.blurPrivateOverridden).toBe(false)
  })
})

import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { ThemeProvider } from "next-themes"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAppearance, useSyncAppearance } from "@/hooks/useAppearance"
import { preferencesQueryKey } from "@/hooks/usePreferences"
import { callsTo, bodyOf, mockFetch } from "@/test/mockApi"
import type { UserPreferences } from "@/types/api"

const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn() } }))

beforeEach(() => {
  toastError.mockReset()
  localStorage.clear()
  document.documentElement.removeAttribute("data-accent")
  // jsdom has no matchMedia, which next-themes uses for "system".
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  )
  return { client, wrapper }
}

const isPrefs = (url: string) => url.endsWith("/auth/preferences")

describe("useSyncAppearance", () => {
  it("applies the server values on the first fetch only, not on a later refetch", async () => {
    let stored: UserPreferences = { theme: "dark", accent: "blue" }
    const fetchMock = mockFetch((url) => (isPrefs(url) ? { status: 200, body: stored } : { status: 404 }))
    const { client, wrapper } = setup()
    renderHook(() => useSyncAppearance(), { wrapper })

    await waitFor(() => expect(document.documentElement.getAttribute("data-accent")).toBe("blue"))
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true))
    expect(localStorage.getItem("packrat-accent-color")).toBe("blue") // cache refreshed
    expect(localStorage.getItem("theme")).toBe("dark")

    stored = { theme: "light", accent: "red" }
    await act(() => client.refetchQueries({ queryKey: preferencesQueryKey }))
    expect(callsTo(fetchMock, "/auth/preferences")).toHaveLength(2)
    expect(document.documentElement.getAttribute("data-accent")).toBe("blue")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("ignores cached preference data left over from before the mount", async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: { theme: "light", accent: "green" } }))
    const { client, wrapper } = setup()
    client.setQueryData(preferencesQueryKey, { theme: "dark", accent: "red" })
    renderHook(() => useSyncAppearance(), { wrapper })
    await waitFor(() => expect(document.documentElement.getAttribute("data-accent")).toBe("green"))
    expect(callsTo(fetchMock, "/auth/preferences")).toHaveLength(1)
  })

  it("requests nothing when it isn't mounted (logged-out pages never call it)", () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: {} }))
    const { wrapper } = setup()
    renderHook(() => 1, { wrapper })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("useAppearance", () => {
  it("applies a change locally at once and PATCHes only that key", async () => {
    const fetchMock = mockFetch((url, init) => (isPrefs(url) ? { status: 200, body: { theme: "dark", accent: "default", ...JSON.parse((init.body as string) ?? "{}") } } : { status: 404 }))
    const { wrapper } = setup()
    const { result } = renderHook(() => useAppearance(), { wrapper })

    act(() => result.current.setAccent("red"))
    expect(document.documentElement.getAttribute("data-accent")).toBe("red")
    expect(localStorage.getItem("packrat-accent-color")).toBe("red")
    expect(result.current.accent).toBe("red")

    act(() => result.current.setTheme("dark"))
    expect(result.current.theme).toBe("dark")

    await waitFor(() => expect(callsTo(fetchMock, "/auth/preferences")).toHaveLength(2))
    const bodies = callsTo(fetchMock, "/auth/preferences").map(bodyOf)
    expect(bodies).toEqual([{ accent: "red" }, { theme: "dark" }])
    expect(callsTo(fetchMock, "/auth/preferences").every(([, init]) => (init as RequestInit).method === "PATCH")).toBe(true)
  })

  it("keeps the value and shows a toast when the PATCH fails", async () => {
    mockFetch(() => ({ status: 500, body: { error: "boom" } }))
    const { wrapper } = setup()
    const { result } = renderHook(() => useAppearance(), { wrapper })

    act(() => result.current.setAccent("green"))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Couldn't save your appearance to the server; kept on this device"))
    expect(document.documentElement.getAttribute("data-accent")).toBe("green")
    expect(result.current.accent).toBe("green")
  })
})

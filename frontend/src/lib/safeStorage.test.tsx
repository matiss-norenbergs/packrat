import { act, cleanup, render, renderHook, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { usePersistedOpen } from "@/hooks/usePersistedOpen"
import { isDesktopNotificationsEnabled, notifyDesktop, setDesktopNotificationsEnabled } from "@/lib/notify"
import { mockFetch } from "@/test/mockApi"
import { readStorage, removeStorage, writeStorage } from "./safeStorage"

const realStorage = Object.getOwnPropertyDescriptor(window, "localStorage")!

// "access": reading window.localStorage throws SecurityError (site data blocked).
// "quota": reads work, setItem throws QuotaExceededError (storage full).
function breakStorage(mode: "access" | "quota") {
  if (mode === "access") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError")
      },
    })
  } else {
    const real = realStorage.value as Storage
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => real.getItem(k),
        removeItem: (k: string) => real.removeItem(k),
        setItem: () => {
          throw new DOMException("full", "QuotaExceededError")
        },
      },
    })
  }
}

beforeEach(() => {
  vi.resetModules()
})
afterEach(() => {
  Object.defineProperty(window, "localStorage", realStorage)
  cleanup()
  vi.unstubAllGlobals()
})

describe.each(["access", "quota"] as const)("with storage broken (%s)", (mode) => {
  it("safeStorage never throws and remembers writes for the session", () => {
    breakStorage(mode)
    expect(() => writeStorage("k", "v")).not.toThrow()
    expect(readStorage("k")).toBe("v")
    expect(() => removeStorage("k")).not.toThrow()
    expect(readStorage("k")).toBeNull()
  })

  it("useAccentColor can be imported and used", async () => {
    breakStorage(mode)
    const mod = await import("@/hooks/useAccentColor")
    const { result } = renderHook(() => mod.useAccentColor())
    expect(result.current.accent).toBe("default")
    act(() => result.current.setAccent("blue"))
    expect(result.current.accent).toBe("blue")
    document.documentElement.removeAttribute("data-accent")
  })

  it("usePersistedOpen toggles", () => {
    breakStorage(mode)
    const { result } = renderHook(() => usePersistedOpen(`k-open-${Math.random()}`, true))
    expect(result.current[0]).toBe(true)
    act(() => result.current[1](false))
    expect(result.current[0]).toBe(false)
  })

  it("notify helpers do not throw", () => {
    breakStorage(mode)
    expect(() => setDesktopNotificationsEnabled(true)).not.toThrow()
    expect(() => isDesktopNotificationsEnabled()).not.toThrow()
    expect(() => notifyDesktop("t", "b")).not.toThrow()
  })

  it("CollectionsPage renders and toggles its panel", async () => {
    breakStorage(mode)
    mockFetch(() => ({ status: 200, body: [] }))
    const { CollectionsPage } = await import("@/pages/CollectionsPage")
    const { TooltipProvider } = await import("@/components/ui/tooltip")
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TooltipProvider>
            <CollectionsPage />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/No collections yet/)).toBeInTheDocument()
  })

  it("ComparePlayPage renders", async () => {
    breakStorage(mode)
    mockFetch(() => ({ status: 200, body: [] }))
    const { ComparePlayPage } = await import("@/pages/ComparePlayPage")
    const { TooltipProvider } = await import("@/components/ui/tooltip")
    expect(() =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <TooltipProvider>
              <ComparePlayPage />
            </TooltipProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    ).not.toThrow()
  })
})

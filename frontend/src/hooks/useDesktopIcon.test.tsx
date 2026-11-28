import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

// jsdom has no canvas: the colors come from <html>'s attributes and the "PNG" is a stand-in.
const renderLogoPng = vi.hoisted(() => vi.fn())
vi.mock("@/lib/appIcon", () => ({
  readLogoColors: () => {
    const root = document.documentElement
    const key = `${root.getAttribute("data-accent") ?? "default"}-${root.classList.contains("dark") ? "dark" : "light"}`
    return { from: `from-${key}`, to: `to-${key}`, glyph: `glyph-${key}` }
  },
  renderLogoPng: (...args: unknown[]) => renderLogoPng(...args),
}))

const store = vi.hoisted(() => ({ confirmed: false, listeners: new Set<() => void>() }))
vi.mock("@/hooks/useAccentColor", () => ({
  isAccentConfirmed: () => store.confirmed,
  subscribeAccent: (l: () => void) => {
    store.listeners.add(l)
    return () => void store.listeners.delete(l)
  },
}))

import { useDesktopIcon } from "@/hooks/useDesktopIcon"
import { act } from "@testing-library/react"
import { flushTasks } from "@/test/settle"
import { enterTauri, leaveTauri } from "@/test/tauriShell"

const confirm = () =>
  act(() => {
    store.confirmed = true
    store.listeners.forEach((l) => l())
  })
const settle = () => act(() => vi.advanceTimersByTimeAsync(200))
const setAccent = (accent: string | null) =>
  act(async () => {
    if (accent) document.documentElement.setAttribute("data-accent", accent)
    else document.documentElement.removeAttribute("data-accent")
    await flushTasks()
  })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  invoke.mockReset().mockResolvedValue(undefined)
  renderLogoPng.mockReset().mockImplementation(async (c: { to: string }) => [1, 2, c.to.length])
  store.confirmed = false
  store.listeners.clear()
  document.documentElement.removeAttribute("data-accent")
  document.documentElement.classList.remove("dark")
  enterTauri()
})

afterEach(() => {
  leaveTauri()
  document.documentElement.removeAttribute("data-accent")
  document.documentElement.classList.remove("dark")
})

describe("useDesktopIcon", () => {
  it("does nothing on the web: no render, no invoke", async () => {
    leaveTauri()
    confirm()
    renderHook(() => useDesktopIcon())
    await settle()
    expect(renderLogoPng).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it("does nothing in the Android build", async () => {
    leaveTauri()
    enterTauri("android")
    confirm()
    renderHook(() => useDesktopIcon())
    await settle()
    expect(invoke).not.toHaveBeenCalled()
  })

  it("leaves the icon alone until the account's accent is known, then sends it once", async () => {
    renderHook(() => useDesktopIcon())
    await settle()
    expect(invoke).not.toHaveBeenCalled()
    confirm()
    await settle()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith("set_app_icon", { png: [1, 2, "to-default-light".length] })
  })

  it("sends a new icon when the accent changes and again when the theme changes", async () => {
    confirm()
    renderHook(() => useDesktopIcon())
    await settle()
    expect(invoke).toHaveBeenCalledTimes(1)
    await setAccent("blue")
    await settle()
    expect(invoke).toHaveBeenCalledTimes(2)
    await act(async () => {
      document.documentElement.classList.add("dark")
      await flushTasks()
    })
    await settle()
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(renderLogoPng).toHaveBeenLastCalledWith(expect.objectContaining({ to: "to-blue-dark" }))
  })

  it("does not send again for a change that leaves the color as it was", async () => {
    confirm()
    renderHook(() => useDesktopIcon())
    await settle()
    expect(invoke).toHaveBeenCalledTimes(1)
    // "default" is the absence of the attribute, so this changes the DOM but not the color.
    await setAccent("default")
    await setAccent(null)
    await settle()
    // Sentinel: a real change after it is sent, so the earlier settle really did run the check.
    await setAccent("red")
    await settle()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(renderLogoPng).toHaveBeenCalledTimes(2)
  })

  it("sends a burst of changes once", async () => {
    confirm()
    renderHook(() => useDesktopIcon())
    await settle()
    invoke.mockClear()
    await setAccent("blue")
    await setAccent("green")
    await setAccent("red")
    await settle()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(renderLogoPng).toHaveBeenLastCalledWith(expect.objectContaining({ to: "to-red-light" }))
  })

  it("swallows a failing invoke and retries on the next change", async () => {
    invoke.mockRejectedValueOnce(new Error("no tray"))
    confirm()
    renderHook(() => useDesktopIcon())
    await settle()
    expect(invoke).toHaveBeenCalledTimes(1)
    await setAccent("blue")
    await settle()
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it("stops observing on unmount", async () => {
    confirm()
    const { unmount } = renderHook(() => useDesktopIcon())
    await settle()
    unmount()
    invoke.mockClear()
    await setAccent("blue")
    await settle()
    expect(invoke).not.toHaveBeenCalled()
  })
})

import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.fn()
let handler: ((event: { payload: unknown }) => void) | null = null
const unlisten = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_name: string, cb: (event: { payload: unknown }) => void) => {
    handler = cb
    return unlisten
  },
}))

import { useTrayServers } from "@/hooks/useTrayServers"
import { activateProfile, addProfile, deactivateProfile } from "@/lib/serverProfiles"

const reload = vi.fn()
const originalLocation = window.location

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  invoke.mockReset().mockResolvedValue(undefined)
  unlisten.mockReset()
  reload.mockReset()
  handler = null
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload } })
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
})

afterEach(() => {
  cleanup()
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation })
})

const lastPush = () => invoke.mock.calls.filter((c) => c[0] === "tray_set_servers").at(-1)?.[1]

describe("useTrayServers", () => {
  it("pushes the servers and the active one on mount", async () => {
    const a = addProfile("http://a:1", "A")
    addProfile("http://b:1", "B")
    activateProfile(a.id)
    renderHook(() => useTrayServers())
    await waitFor(() => expect(lastPush()).toBeDefined())
    expect(lastPush()).toEqual({
      servers: [
        { id: a.id, name: "A" },
        { id: expect.any(String), name: "B" },
      ],
      activeId: a.id,
    })
  })

  it("pushes again when a profile or the active server changes", async () => {
    const a = addProfile("http://a:1", "A")
    activateProfile(a.id)
    renderHook(() => useTrayServers())
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    const b = addProfile("http://b:1", "B")
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    activateProfile(b.id)
    await waitFor(() => expect(lastPush()).toMatchObject({ activeId: b.id }))
    deactivateProfile()
    await waitFor(() => expect(lastPush()).toMatchObject({ activeId: null }))
  })

  it("switches and reloads when the tray reports a known server", async () => {
    const a = addProfile("http://a:1", "A")
    const b = addProfile("http://b:1", "B")
    activateProfile(a.id)
    renderHook(() => useTrayServers())
    await waitFor(() => expect(handler).not.toBeNull())
    handler!({ payload: b.id })
    expect(window.localStorage.getItem("packrat.activeProfile")).toBe(b.id)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("ignores an unknown id", async () => {
    const a = addProfile("http://a:1", "A")
    activateProfile(a.id)
    renderHook(() => useTrayServers())
    await waitFor(() => expect(handler).not.toBeNull())
    handler!({ payload: "nope" })
    handler!({ payload: 42 })
    expect(window.localStorage.getItem("packrat.activeProfile")).toBe(a.id)
    expect(reload).not.toHaveBeenCalled()
  })

  it("stops listening on unmount", async () => {
    const { unmount } = renderHook(() => useTrayServers())
    await waitFor(() => expect(handler).not.toBeNull())
    unmount()
    await waitFor(() => expect(unlisten).toHaveBeenCalled())
  })

  it("does nothing on the web", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    addProfile("http://a:1", "A")
    renderHook(() => useTrayServers())
    await new Promise((r) => setTimeout(r, 20))
    expect(invoke).not.toHaveBeenCalled()
    expect(handler).toBeNull()
  })
})

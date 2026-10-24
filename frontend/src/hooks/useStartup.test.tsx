import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let autostart = false
let startMinimized = false
const calls: Array<[string, unknown]> = []
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: { enabled: boolean }) => {
    calls.push([cmd, args])
    if (cmd === "autostart_is_enabled") return autostart
    if (cmd === "autostart_set") return void (autostart = args!.enabled)
    if (cmd === "get_start_minimized") return startMinimized
    if (cmd === "set_start_minimized") return void (startMinimized = args!.enabled)
    throw new Error(`unexpected command ${cmd}`)
  },
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

import { useStartup } from "@/hooks/useStartup"

afterEach(cleanup)
beforeEach(() => {
  autostart = false
  startMinimized = false
  calls.length = 0
})

const writes = () => calls.filter(([cmd]) => cmd.endsWith("_set") || cmd === "set_start_minimized")

describe("useStartup", () => {
  it("is unknown while loading", () => {
    const { result } = renderHook(() => useStartup())
    expect(result.current.mode).toBeNull()
  })

  it.each([
    [false, false, "off"],
    [false, true, "off"],
    [true, false, "shown"],
    [true, true, "hidden"],
  ])("derives the mode from autostart=%s startMinimized=%s", async (a, m, expected) => {
    autostart = a
    startMinimized = m
    const { result } = renderHook(() => useStartup())
    await waitFor(() => expect(result.current.mode).toBe(expected))
  })

  it("'shown' turns autostart on and the pref off", async () => {
    startMinimized = true
    const { result } = renderHook(() => useStartup())
    await waitFor(() => expect(result.current.mode).toBe("off"))
    await act(() => result.current.setMode("shown"))
    expect(writes()).toEqual([
      ["set_start_minimized", { enabled: false }],
      ["autostart_set", { enabled: true }],
    ])
    expect(result.current.mode).toBe("shown")
  })

  it("'hidden' turns autostart and the pref on", async () => {
    const { result } = renderHook(() => useStartup())
    await waitFor(() => expect(result.current.mode).toBe("off"))
    await act(() => result.current.setMode("hidden"))
    expect(writes()).toEqual([
      ["set_start_minimized", { enabled: true }],
      ["autostart_set", { enabled: true }],
    ])
    expect(result.current.mode).toBe("hidden")
  })

  it("'off' only removes the OS entry and leaves the pref alone", async () => {
    autostart = true
    startMinimized = true
    const { result } = renderHook(() => useStartup())
    await waitFor(() => expect(result.current.mode).toBe("hidden"))
    await act(() => result.current.setMode("off"))
    expect(writes()).toEqual([["autostart_set", { enabled: false }]])
    expect(result.current.mode).toBe("off")
    expect(startMinimized).toBe(true)
  })
})

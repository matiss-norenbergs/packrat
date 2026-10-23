import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.fn()
const relaunch = vi.fn()
let progress: ((e: { payload: { downloaded: number; total: number | null } }) => void) | null = null
const unlisten = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }))
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_name: string, cb: typeof progress) => {
    progress = cb
    return unlisten
  },
}))
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunch() }))

import { useMatchServerVersion } from "@/hooks/useMatchServerVersion"

beforeEach(() => {
  invoke.mockReset()
  relaunch.mockReset()
  unlisten.mockReset()
  progress = null
})

describe("useMatchServerVersion", () => {
  it("does nothing until asked, and never for a non-release server version", async () => {
    const { result } = renderHook(() => useMatchServerVersion())
    expect(result.current.state).toEqual({ status: "idle" })
    for (const bad of ["dev", "1.2.3-rc.1", "v1.2.3", "1.2.3/../x", "", undefined])
      await act(() => result.current.check(bad))
    expect(invoke).not.toHaveBeenCalled()
    expect(result.current.state).toEqual({ status: "idle" })
  })

  it("asks to confirm an upgrade, then installs and relaunches", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "match_update_check") return { version: "1.3.0", currentVersion: "1.2.0" }
      progress?.({ payload: { downloaded: 50, total: 100 } })
      return null
    })
    const { result } = renderHook(() => useMatchServerVersion())
    await act(() => result.current.check("1.3.0"))
    expect(invoke).toHaveBeenCalledWith("match_update_check", { version: "1.3.0" })
    expect(result.current.state).toEqual({
      status: "confirm",
      version: "1.3.0",
      currentVersion: "1.2.0",
      downgrade: false,
    })
    expect(relaunch).not.toHaveBeenCalled()

    await act(() => result.current.install())
    expect(invoke).toHaveBeenCalledWith("match_update_install")
    expect(relaunch).toHaveBeenCalledTimes(1)
    expect(unlisten).toHaveBeenCalledTimes(1)
    expect(result.current.state).toEqual({ status: "installing", downloaded: 50, total: 100 })
  })

  it("flags a downgrade", async () => {
    invoke.mockResolvedValue({ version: "1.1.0", currentVersion: "1.2.0" })
    const { result } = renderHook(() => useMatchServerVersion())
    await act(() => result.current.check("1.1.0"))
    expect(result.current.state).toMatchObject({ status: "confirm", downgrade: true })
  })

  it("reports a match when there is nothing to install", async () => {
    invoke.mockResolvedValue(null)
    const { result } = renderHook(() => useMatchServerVersion())
    await act(() => result.current.check("1.2.0"))
    expect(result.current.state).toEqual({ status: "matches" })
  })

  it("can be cancelled at the confirmation", async () => {
    invoke.mockResolvedValue({ version: "1.3.0", currentVersion: "1.2.0" })
    const { result } = renderHook(() => useMatchServerVersion())
    await act(() => result.current.check("1.3.0"))
    act(() => result.current.cancel())
    expect(result.current.state).toEqual({ status: "idle" })
    expect(relaunch).not.toHaveBeenCalled()
  })

  it("surfaces a failed check", async () => {
    invoke.mockRejectedValue("No desktop build is published for server version 9.9.9")
    const { result } = renderHook(() => useMatchServerVersion())
    await act(() => result.current.check("9.9.9"))
    expect(result.current.state).toEqual({
      status: "error",
      during: "check",
      message: "No desktop build is published for server version 9.9.9",
    })
  })

  it("surfaces a failed install without relaunching, and stops listening", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "match_update_check") return { version: "1.3.0", currentVersion: "1.2.0" }
      throw "signature verification failed"
    })
    const { result } = renderHook(() => useMatchServerVersion())
    await act(() => result.current.check("1.3.0"))
    await act(() => result.current.install())
    expect(result.current.state).toEqual({
      status: "error",
      during: "install",
      message: "signature verification failed",
    })
    expect(relaunch).not.toHaveBeenCalled()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })
})

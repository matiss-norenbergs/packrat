import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const check = vi.fn()
const relaunch = vi.fn()
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }))
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunch() }))

import { useAppUpdate } from "@/hooks/useAppUpdate"

beforeEach(() => {
  check.mockReset()
  relaunch.mockReset()
})

describe("useAppUpdate", () => {
  it("does nothing until asked", () => {
    const { result } = renderHook(() => useAppUpdate())
    expect(result.current.state).toEqual({ status: "idle" })
    expect(check).not.toHaveBeenCalled()
  })

  it("reports up to date when there is no newer release", async () => {
    check.mockResolvedValue(null)
    const { result } = renderHook(() => useAppUpdate())
    await act(() => result.current.check())
    expect(result.current.state).toEqual({ status: "upToDate" })
  })

  it("reports an available update, then downloads, installs and relaunches on demand", async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } })
      onEvent({ event: "Progress", data: { chunkLength: 40 } })
      onEvent({ event: "Progress", data: { chunkLength: 60 } })
      onEvent({ event: "Finished" })
    })
    check.mockResolvedValue({ version: "0.9.0", body: "notes", downloadAndInstall })
    const { result } = renderHook(() => useAppUpdate())

    await act(() => result.current.check())
    expect(result.current.state).toEqual({ status: "available", version: "0.9.0", notes: "notes" })
    expect(downloadAndInstall).not.toHaveBeenCalled()
    expect(relaunch).not.toHaveBeenCalled()

    await act(() => result.current.install())
    expect(downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(relaunch).toHaveBeenCalledTimes(1)
    expect(result.current.state).toEqual({ status: "installing", downloaded: 100, total: 100 })
  })

  it("surfaces a failed check", async () => {
    check.mockRejectedValue("404 Not Found")
    const { result } = renderHook(() => useAppUpdate())
    await act(() => result.current.check())
    expect(result.current.state).toEqual({ status: "error", during: "check", message: "404 Not Found" })
  })

  it("surfaces a failed install without relaunching", async () => {
    check.mockResolvedValue({
      version: "0.9.0",
      body: null,
      downloadAndInstall: vi.fn().mockRejectedValue(new Error("signature mismatch")),
    })
    const { result } = renderHook(() => useAppUpdate())
    await act(() => result.current.check())
    await act(() => result.current.install())
    expect(result.current.state).toEqual({ status: "error", during: "install", message: "signature mismatch" })
    expect(relaunch).not.toHaveBeenCalled()
  })
})

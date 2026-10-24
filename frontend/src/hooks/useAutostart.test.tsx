import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const isEnabled = vi.fn()
const setAutostart = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: { enabled: boolean }) => {
    if (cmd === "autostart_is_enabled") return isEnabled()
    if (cmd === "autostart_set") return setAutostart(args)
    throw new Error(`unexpected command ${cmd}`)
  },
}))
const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }))

import { useAutostart } from "@/hooks/useAutostart"

afterEach(cleanup)

beforeEach(() => {
  isEnabled.mockReset()
  setAutostart.mockReset()
  toastError.mockReset()
})

describe("useAutostart", () => {
  it("reads the real state from the OS rather than keeping its own flag", async () => {
    isEnabled.mockResolvedValue(true)
    const { result } = renderHook(() => useAutostart())
    expect(result.current.enabled).toBeNull()
    await waitFor(() => expect(result.current.enabled).toBe(true))
  })

  it("enables, then re-reads what the OS reports", async () => {
    isEnabled.mockResolvedValueOnce(false).mockResolvedValue(true)
    setAutostart.mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutostart())
    await waitFor(() => expect(result.current.enabled).toBe(false))
    await act(() => result.current.setEnabled(true))
    expect(setAutostart).toHaveBeenCalledTimes(1)
    expect(setAutostart).toHaveBeenCalledWith({ enabled: true })
    expect(result.current.enabled).toBe(true)
  })

  it("disables through the shell", async () => {
    isEnabled.mockResolvedValueOnce(true).mockResolvedValue(false)
    setAutostart.mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutostart())
    await waitFor(() => expect(result.current.enabled).toBe(true))
    await act(() => result.current.setEnabled(false))
    expect(setAutostart).toHaveBeenCalledWith({ enabled: false })
    expect(result.current.enabled).toBe(false)
  })

  it("reports a failure and keeps showing the OS state", async () => {
    isEnabled.mockResolvedValue(false)
    setAutostart.mockRejectedValue(new Error("permission denied"))
    const { result } = renderHook(() => useAutostart())
    await waitFor(() => expect(result.current.enabled).toBe(false))
    await act(() => result.current.setEnabled(true))
    expect(toastError).toHaveBeenCalledWith("Couldn't change launch at login: permission denied")
    expect(result.current.enabled).toBe(false)
  })

  it("stays unknown when the state can't be read", async () => {
    isEnabled.mockRejectedValue(new Error("no plugin"))
    const { result } = renderHook(() => useAutostart())
    await waitFor(() => expect(isEnabled).toHaveBeenCalled())
    expect(result.current.enabled).toBeNull()
  })
})

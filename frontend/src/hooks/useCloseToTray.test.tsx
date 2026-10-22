import { renderHook, waitFor, act } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

import { useCloseToTray } from "@/hooks/useCloseToTray"

beforeEach(() => invoke.mockReset())

describe("useCloseToTray", () => {
  it("loads the saved value from the shell", async () => {
    invoke.mockResolvedValue(false)
    const { result } = renderHook(() => useCloseToTray())
    expect(result.current.enabled).toBeNull()
    await waitFor(() => expect(result.current.enabled).toBe(false))
    expect(invoke).toHaveBeenCalledWith("get_close_to_tray")
  })

  it("saves a change through the shell and reflects it", async () => {
    invoke.mockResolvedValueOnce(true).mockResolvedValue(undefined)
    const { result } = renderHook(() => useCloseToTray())
    await waitFor(() => expect(result.current.enabled).toBe(true))
    await act(() => result.current.setEnabled(false))
    expect(invoke).toHaveBeenLastCalledWith("set_close_to_tray", { enabled: false })
    expect(result.current.enabled).toBe(false)
  })

  it("keeps the old value when saving fails", async () => {
    invoke.mockResolvedValueOnce(true).mockRejectedValueOnce("disk full")
    const { result } = renderHook(() => useCloseToTray())
    await waitFor(() => expect(result.current.enabled).toBe(true))
    await act(() => result.current.setEnabled(false))
    expect(result.current.enabled).toBe(true)
  })
})

import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

import { useStartMinimized } from "@/hooks/useStartMinimized"

beforeEach(() => {
  invoke.mockReset()
})
afterEach(cleanup)

describe("useStartMinimized", () => {
  it("loads the saved value from the shell", async () => {
    invoke.mockResolvedValue(true)
    const { result } = renderHook(() => useStartMinimized())
    expect(result.current.enabled).toBeNull()
    await waitFor(() => expect(result.current.enabled).toBe(true))
    expect(invoke).toHaveBeenCalledWith("get_start_minimized")
  })

  it("defaults to off when the shell can't be asked", async () => {
    invoke.mockRejectedValue("no shell")
    const { result } = renderHook(() => useStartMinimized())
    await waitFor(() => expect(result.current.enabled).toBe(false))
  })

  it("saves a change through the shell and reflects it", async () => {
    invoke.mockResolvedValueOnce(false).mockResolvedValue(undefined)
    const { result } = renderHook(() => useStartMinimized())
    await waitFor(() => expect(result.current.enabled).toBe(false))
    await act(() => result.current.setEnabled(true))
    expect(invoke).toHaveBeenLastCalledWith("set_start_minimized", { enabled: true })
    expect(result.current.enabled).toBe(true)
  })
})

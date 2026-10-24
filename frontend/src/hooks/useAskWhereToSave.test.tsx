import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

import { useAskWhereToSave } from "@/hooks/useAskWhereToSave"

beforeEach(() => {
  invoke.mockReset()
})
afterEach(cleanup)

describe("useAskWhereToSave", () => {
  it("loads the saved value from the shell", async () => {
    invoke.mockResolvedValue(true)
    const { result } = renderHook(() => useAskWhereToSave())
    expect(result.current.enabled).toBeNull()
    await waitFor(() => expect(result.current.enabled).toBe(true))
    expect(invoke).toHaveBeenCalledWith("get_ask_where_to_save")
  })

  it("defaults to off when the shell can't be asked", async () => {
    invoke.mockRejectedValue("no shell")
    const { result } = renderHook(() => useAskWhereToSave())
    await waitFor(() => expect(result.current.enabled).toBe(false))
  })

  it("saves a change through the shell and reflects it", async () => {
    invoke.mockResolvedValueOnce(false).mockResolvedValue(undefined)
    const { result } = renderHook(() => useAskWhereToSave())
    await waitFor(() => expect(result.current.enabled).toBe(false))
    await act(() => result.current.setEnabled(true))
    expect(invoke).toHaveBeenLastCalledWith("set_ask_where_to_save", { enabled: true })
    expect(result.current.enabled).toBe(true)
  })
})

import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }))

import { useDownloadFolder } from "@/hooks/useDownloadFolder"

const DEFAULT = { path: "/home/me/Downloads", isDefault: true }

beforeEach(() => {
  invoke.mockReset()
  toastError.mockReset()
})
afterEach(cleanup)

describe("useDownloadFolder", () => {
  it("loads the current folder from the shell", async () => {
    invoke.mockResolvedValue(DEFAULT)
    const { result } = renderHook(() => useDownloadFolder())
    expect(result.current.folder).toBeNull()
    await waitFor(() => expect(result.current.folder).toEqual(DEFAULT))
    expect(invoke).toHaveBeenCalledWith("get_download_folder")
  })

  it("Change… shows the picked folder", async () => {
    invoke.mockResolvedValueOnce(DEFAULT).mockResolvedValueOnce({ path: "/media/videos", isDefault: false })
    const { result } = renderHook(() => useDownloadFolder())
    await waitFor(() => expect(result.current.folder).toEqual(DEFAULT))
    await act(() => result.current.choose())
    expect(invoke).toHaveBeenLastCalledWith("choose_download_folder")
    expect(result.current.folder).toEqual({ path: "/media/videos", isDefault: false })
  })

  it("keeps the folder when the picker is dismissed", async () => {
    invoke.mockResolvedValueOnce(DEFAULT).mockResolvedValueOnce(null)
    const { result } = renderHook(() => useDownloadFolder())
    await waitFor(() => expect(result.current.folder).toEqual(DEFAULT))
    await act(() => result.current.choose())
    expect(result.current.folder).toEqual(DEFAULT)
    expect(toastError).not.toHaveBeenCalled()
  })

  it("goes back to the default folder", async () => {
    invoke.mockResolvedValueOnce({ path: "/media/videos", isDefault: false }).mockResolvedValueOnce(DEFAULT)
    const { result } = renderHook(() => useDownloadFolder())
    await waitFor(() => expect(result.current.folder?.isDefault).toBe(false))
    await act(() => result.current.reset())
    expect(invoke).toHaveBeenLastCalledWith("reset_download_folder")
    expect(result.current.folder).toEqual(DEFAULT)
  })

  it("reports a failure and keeps what it had", async () => {
    invoke.mockResolvedValueOnce(DEFAULT).mockRejectedValueOnce("Not a folder.")
    const { result } = renderHook(() => useDownloadFolder())
    await waitFor(() => expect(result.current.folder).toEqual(DEFAULT))
    await act(() => result.current.choose())
    expect(toastError).toHaveBeenCalledWith("Couldn't change the folder: Not a folder.")
    expect(result.current.folder).toEqual(DEFAULT)
  })
})

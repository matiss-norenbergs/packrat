import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Handler = (e: { payload: unknown }) => void
const handlers: Record<string, Handler> = {}
const unlisten = vi.fn()
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, fn: Handler) => {
    handlers[name] = fn
    return unlisten
  },
}))
const reveal = vi.fn()
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: (p: string) => reveal(p) }))
const { toast } = vi.hoisted(() => ({ toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }))
vi.mock("sonner", () => ({ toast }))

import { useDownloadToasts } from "@/hooks/useDownloadToasts"

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(handlers)) delete handlers[k]
})

describe("useDownloadToasts", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it("does nothing outside the Tauri shell", async () => {
    renderHook(() => useDownloadToasts())
    await new Promise((r) => setTimeout(r, 10))
    expect(handlers["download-started"]).toBeUndefined()
  })

  describe("in the shell", () => {
    beforeEach(() => {
      ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    })

    it("replaces the downloading toast with the result, offering Show in folder", async () => {
      renderHook(() => useDownloadToasts())
      await waitFor(() => expect(handlers["download-finished"]).toBeDefined())

      handlers["download-started"]({ payload: { filename: "b.json", path: "/dl/b.json" } })
      expect(toast.loading).toHaveBeenCalledWith("Downloading b.json…", expect.objectContaining({ id: "/dl/b.json" }))

      handlers["download-finished"]({ payload: { path: "/dl/b.json", success: true } })
      const [message, options] = toast.success.mock.calls[0]
      expect(message).toBe("Saved to /dl/b.json")
      expect(options.id).toBe("/dl/b.json")
      options.action.onClick()
      await waitFor(() => expect(reveal).toHaveBeenCalledWith("/dl/b.json"))
    })

    it("turns a failed download into an error on the same toast", async () => {
      renderHook(() => useDownloadToasts())
      await waitFor(() => expect(handlers["download-finished"]).toBeDefined())
      handlers["download-started"]({ payload: { filename: "b.json", path: "/dl/b.json" } })
      handlers["download-finished"]({ payload: { path: null, success: false } })
      expect(toast.error).toHaveBeenCalledWith("Download failed", expect.objectContaining({ id: "/dl/b.json" }))
    })

    it("settles the toast named by the event when the file was saved somewhere else", async () => {
      renderHook(() => useDownloadToasts())
      await waitFor(() => expect(handlers["download-finished"]).toBeDefined())
      handlers["download-started"]({ payload: { filename: "b.json", path: "/cache/0/b.json" } })
      handlers["download-started"]({ payload: { filename: "c.json", path: "/cache/1/c.json" } })
      handlers["download-finished"]({
        payload: { path: "/home/me/c.json", id: "/cache/1/c.json", success: true, cancelled: false },
      })
      const [message, options] = toast.success.mock.calls[0]
      expect(message).toBe("Saved to /home/me/c.json")
      expect(options.id).toBe("/cache/1/c.json") // not the older b.json toast
    })

    it("just dismisses the toast when the Save dialog was cancelled", async () => {
      renderHook(() => useDownloadToasts())
      await waitFor(() => expect(handlers["download-finished"]).toBeDefined())
      handlers["download-started"]({ payload: { filename: "b.json", path: "/cache/0/b.json" } })
      handlers["download-finished"]({
        payload: { path: null, id: "/cache/0/b.json", success: false, cancelled: true },
      })
      expect(toast.dismiss).toHaveBeenCalledWith("/cache/0/b.json")
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it("stops listening on unmount", async () => {
      const { unmount } = renderHook(() => useDownloadToasts())
      await waitFor(() => expect(handlers["download-finished"]).toBeDefined())
      unmount()
      expect(unlisten).toHaveBeenCalledTimes(2)
    })
  })
})

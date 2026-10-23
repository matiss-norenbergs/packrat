import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let serverVersion = "1.3.0"
vi.mock("@/hooks/useSettings", () => ({ useAppVersion: () => ({ data: { version: serverVersion } }) }))
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => appVersion }))
let appVersion = "1.2.0"

import { useVersionMismatchNotice } from "@/hooks/useVersionMismatchNotice"

beforeEach(() => {
  localStorage.clear()
  serverVersion = "1.3.0"
  appVersion = "1.2.0"
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
})
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
})

describe("useVersionMismatchNotice", () => {
  it("reports a newer server, and stays dismissed for that version pair only", async () => {
    const { result, unmount } = renderHook(() => useVersionMismatchNotice())
    await waitFor(() => expect(result.current.notice).toEqual({ kind: "server-newer", server: "1.3.0", app: "1.2.0" }))
    act(() => result.current.dismiss())
    expect(result.current.notice).toBeNull()
    unmount()

    // Remembered across launches…
    const again = renderHook(() => useVersionMismatchNotice())
    await new Promise((r) => setTimeout(r, 10))
    expect(again.result.current.notice).toBeNull()
    again.unmount()

    // …but a different server version brings it back.
    serverVersion = "1.4.0"
    const next = renderHook(() => useVersionMismatchNotice())
    await waitFor(() => expect(next.result.current.notice).toEqual({ kind: "server-newer", server: "1.4.0", app: "1.2.0" }))
  })

  it("keeps honouring a dismissal stored by the earlier server-newer-only notice", async () => {
    localStorage.setItem("packrat.dismissedServerNewer", "1.3.0|1.2.0")
    const { result } = renderHook(() => useVersionMismatchNotice())
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.notice).toBeNull()
  })

  it("reports a newer app, dismissed per version pair and independently of the other direction", async () => {
    serverVersion = "1.2.0"
    appVersion = "1.3.0"
    const { result, unmount } = renderHook(() => useVersionMismatchNotice())
    await waitFor(() => expect(result.current.notice).toEqual({ kind: "app-newer", server: "1.2.0", app: "1.3.0" }))
    act(() => result.current.dismiss())
    expect(result.current.notice).toBeNull()
    expect(localStorage.getItem("packrat.dismissedAppNewer")).toBe("1.2.0|1.3.0")
    expect(localStorage.getItem("packrat.dismissedServerNewer")).toBeNull()
    unmount()

    const again = renderHook(() => useVersionMismatchNotice())
    await new Promise((r) => setTimeout(r, 10))
    expect(again.result.current.notice).toBeNull()
    again.unmount()

    // A server upgrade changes the pair, so the notice returns.
    serverVersion = "1.2.5"
    const next = renderHook(() => useVersionMismatchNotice())
    await waitFor(() =>
      expect(next.result.current.notice).toEqual({ kind: "app-newer", server: "1.2.5", app: "1.3.0" }),
    )
  })

  it("treats a pre-release app as older than its release", async () => {
    serverVersion = "1.3.0"
    appVersion = "1.3.0-rc.1"
    const { result } = renderHook(() => useVersionMismatchNotice())
    await waitFor(() =>
      expect(result.current.notice).toEqual({ kind: "server-newer", server: "1.3.0", app: "1.3.0-rc.1" }),
    )
  })

  it("says nothing for dev servers, equal versions or garbage", async () => {
    for (const [server, app] of [["dev", "1.2.0"], ["1.2.0", "1.2.0"], ["1.2.0", "dev"], ["x", "y"]]) {
      serverVersion = server
      appVersion = app
      const { result, unmount } = renderHook(() => useVersionMismatchNotice())
      await new Promise((r) => setTimeout(r, 10))
      expect(result.current.notice).toBeNull()
      unmount()
    }
  })
})

import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let serverVersion = "1.3.0"
vi.mock("@/hooks/useSettings", () => ({ useAppVersion: () => ({ data: { version: serverVersion } }) }))
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => appVersion }))
let appVersion = "1.2.0"

import { useServerNewerNotice } from "@/hooks/useServerNewerNotice"

beforeEach(() => {
  localStorage.clear()
  serverVersion = "1.3.0"
  appVersion = "1.2.0"
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
})
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
})

describe("useServerNewerNotice", () => {
  it("reports a newer server, and stays dismissed for that version pair only", async () => {
    const { result, unmount } = renderHook(() => useServerNewerNotice())
    await waitFor(() => expect(result.current.notice).toEqual({ server: "1.3.0", app: "1.2.0" }))
    act(() => result.current.dismiss())
    expect(result.current.notice).toBeNull()
    unmount()

    // Remembered across launches…
    const again = renderHook(() => useServerNewerNotice())
    await new Promise((r) => setTimeout(r, 10))
    expect(again.result.current.notice).toBeNull()
    again.unmount()

    // …but a different server version brings it back.
    serverVersion = "1.4.0"
    const next = renderHook(() => useServerNewerNotice())
    await waitFor(() => expect(next.result.current.notice).toEqual({ server: "1.4.0", app: "1.2.0" }))
  })

  it("says nothing for dev servers or when the app is newer or equal", async () => {
    for (const [server, app] of [["dev", "1.2.0"], ["1.2.0", "1.2.0"], ["1.0.0", "1.2.0"]]) {
      serverVersion = server
      appVersion = app
      const { result, unmount } = renderHook(() => useServerNewerNotice())
      await new Promise((r) => setTimeout(r, 10))
      expect(result.current.notice).toBeNull()
      unmount()
    }
  })
})

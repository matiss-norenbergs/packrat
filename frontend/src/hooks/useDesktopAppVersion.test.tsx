import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

let getVersion: () => Promise<string> = () => Promise.resolve("")
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => getVersion() }))

import { useDesktopAppVersion } from "@/hooks/useDesktopAppVersion"

afterEach(cleanup)

describe("useDesktopAppVersion", () => {
  it("is null while loading, then the app version", async () => {
    getVersion = () => Promise.resolve("0.18.2")
    const { result } = renderHook(() => useDesktopAppVersion())
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toBe("0.18.2"))
  })

  it("stays null when getVersion fails", async () => {
    getVersion = () => Promise.reject(new Error("nope"))
    const { result } = renderHook(() => useDesktopAppVersion())
    // Let the dynamic import and the rejected getVersion() settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(result.current).toBeNull()
  })
})

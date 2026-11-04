import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WSEvent } from "@/types/ws"
import { libraryQueryKey } from "./useLibrary"
import { useDownloadsSocket } from "./useDownloadsSocket"

let emit: (e: WSEvent) => void = () => {}

vi.mock("@/lib/ws", () => ({
  connectDownloadsSocket: (onEvent: (e: WSEvent) => void) => {
    emit = onEvent
    return { addEventListener: () => {}, close: () => {} }
  },
}))
vi.mock("@/lib/notify", () => ({
  notifyDesktop: vi.fn(),
  notifyDesktopAsync: vi.fn(),
  notifyEvent: vi.fn(),
  notifyEventAsync: vi.fn(),
}))
vi.mock("@/lib/connection", () => ({ reportNetworkFailure: vi.fn(), reportReachable: vi.fn() }))

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  renderHook(() => useDownloadsSocket(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
})
afterEach(() => cleanup())

describe("useDownloadsSocket library refresh", () => {
  it.each<[string, WSEvent]>([
    ["library_changed (ghost created)", { type: "library_changed", payload: { libraryId: 1, reason: "ghost_created" } }],
    ["library_changed (ghost removed)", { type: "library_changed", payload: { libraryId: 1, reason: "ghost_removed" } }],
    ["completed", { type: "completed", payload: { downloadId: 1, libraryId: 1, title: "t" } }],
    ["failed", { type: "failed", payload: { downloadId: 1, status: "failed", error: "boom" } }],
    ["cancelled", { type: "failed", payload: { downloadId: 1, status: "cancelled", error: "cancelled by user" } }],
  ])("invalidates the library queries on %s", (_name, event) => {
    const spy = vi.spyOn(client, "invalidateQueries")
    emit(event)
    expect(spy).toHaveBeenCalledWith({ queryKey: libraryQueryKey })
  })

  it("does not touch the library on a plain queue update", () => {
    const spy = vi.spyOn(client, "invalidateQueries")
    emit({ type: "queue_update", payload: { active: 1, queued: 0 } })
    expect(spy).not.toHaveBeenCalledWith({ queryKey: libraryQueryKey })
  })
})

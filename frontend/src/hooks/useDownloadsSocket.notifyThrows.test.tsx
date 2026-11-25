import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { INVALIDATION_WINDOW_MS } from "@/lib/queryInvalidation"
import type { WSEvent } from "@/types/ws"
import { useDownloadsSocket } from "./useDownloadsSocket"

let emit: (e: WSEvent) => void = () => {}
vi.mock("@/lib/ws", () => ({
  connectDownloadsSocket: (onEvent: (e: WSEvent) => void) => {
    emit = onEvent
    return { addEventListener: () => {}, close: () => {} }
  },
}))
const boom = () => {
  throw new Error("notification failed")
}
vi.mock("@/lib/notify", () => ({
  notifyDesktop: () => boom(),
  notifyDesktopAsync: () => boom(),
  notifyEvent: () => boom(),
  notifyEventAsync: () => boom(),
}))
vi.mock("@/lib/connection", () => ({ reportNetworkFailure: vi.fn(), reportReachable: vi.fn() }))

let invalidate: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.useFakeTimers()
  const client = new QueryClient()
  invalidate = vi.spyOn(client, "invalidateQueries")
  renderHook(() => useDownloadsSocket(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("a throwing notification never prevents the invalidation in the same case", () => {
  it.each<[string, WSEvent]>([
    ["completed", { type: "completed", payload: { downloadId: 1, libraryId: 2, title: "t" } } as WSEvent],
    ["failed", { type: "failed", payload: { downloadId: 1, status: "failed", error: "x" } } as WSEvent],
    ["subscription_new_items", { type: "subscription_new_items", payload: { subscriptionTitle: "s", newCount: 1 } } as WSEvent],
    ["backup_completed", { type: "backup_completed", payload: { errorMessage: "e" } } as WSEvent],
  ])("%s", (_name, event) => {
    try {
      emit(event) // the real socket wrapper (lib/ws) catches and logs this
    } catch {
      // expected: the mocked notification threw
    }
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS)
    expect(invalidate).toHaveBeenCalled()
  })
})

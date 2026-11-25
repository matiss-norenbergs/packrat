import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { INVALIDATION_WINDOW_MS } from "@/lib/queryInvalidation"
import { collectionsQueryKey, libraryQueryKey } from "@/lib/queryKeys"
import { isSocketOpen, pollWhileSocketDown } from "@/lib/socketState"
import type { WSEvent } from "@/types/ws"
import { downloadsQueryKey } from "./useDownloads"
import { useDownloadsSocket, WAKE_AFTER_HIDDEN_MS } from "./useDownloadsSocket"

type Listener = () => void
class FakeSocket {
  readyState: number = WebSocket.CONNECTING
  closeCalls = 0
  private listeners = new Map<string, Listener[]>()
  onEvent: (e: WSEvent) => void
  constructor(onEvent: (e: WSEvent) => void) {
    this.onEvent = onEvent
  }
  addEventListener(type: string, fn: Listener, opts?: { once?: boolean }) {
    const wrapped = opts?.once ? () => { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== wrapped)); fn() } : fn
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), wrapped])
  }
  fire(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn()
  }
  open() {
    this.readyState = WebSocket.OPEN
    this.fire("open")
  }
  close() {
    this.closeCalls += 1
    this.readyState = WebSocket.CLOSED
    this.fire("close")
  }
}

const sockets: FakeSocket[] = []
vi.mock("@/lib/ws", () => ({
  connectDownloadsSocket: (onEvent: (e: WSEvent) => void) => {
    const s = new FakeSocket(onEvent)
    sockets.push(s)
    return s
  },
}))
vi.mock("@/lib/notify", () => ({ notifyDesktop: vi.fn(), notifyDesktopAsync: vi.fn(), notifyEvent: vi.fn(), notifyEventAsync: vi.fn() }))
const reportNetworkFailure = vi.fn()
vi.mock("@/lib/connection", () => ({
  reportNetworkFailure: (...a: unknown[]) => reportNetworkFailure(...a),
  reportReachable: vi.fn(),
}))

let client: QueryClient
let invalidate: ReturnType<typeof vi.spyOn>
const keys = () => invalidate.mock.calls.map((c: unknown[]) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey)).sort()
const refetchKeys = [downloadsQueryKey, libraryQueryKey, collectionsQueryKey].map((k) => JSON.stringify(k)).sort()

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event("visibilitychange"))
}
const mount = () =>
  renderHook(() => useDownloadsSocket(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
const connected = () => {
  const view = mount()
  sockets[0].open()
  vi.advanceTimersByTime(INVALIDATION_WINDOW_MS) // the initial open refetch
  invalidate.mockClear()
  return view
}
const away = (ms: number) => {
  setHidden(true)
  vi.advanceTimersByTime(ms)
  setHidden(false)
}

beforeEach(() => {
  vi.useFakeTimers()
  sockets.length = 0
  reportNetworkFailure.mockClear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  invalidate = vi.spyOn(client, "invalidateQueries")
  setHidden(false)
})
afterEach(() => {
  cleanup()
  setHidden(false)
  vi.useRealTimers()
})

describe("useDownloadsSocket wake after a long absence", () => {
  it("does nothing extra after a short absence", () => {
    connected()
    away(WAKE_AFTER_HIDDEN_MS - 1000)
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS * 2)
    expect(sockets).toHaveLength(1)
    expect(sockets[0].closeCalls).toBe(0)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it("after a long absence with nothing pending: one coalesced refetch and a replaced socket", () => {
    connected()
    away(WAKE_AFTER_HIDDEN_MS)
    expect(sockets).toHaveLength(2)
    expect(sockets[0].closeCalls).toBe(1)
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS)
    expect(keys()).toEqual(refetchKeys)
    // The replacement's own open refetch coalesces into a single further round, never a second one per key.
    sockets[1].open()
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS)
    expect(keys()).toEqual([...refetchKeys, ...refetchKeys].sort())
  })

  it("replaces the socket quietly: no failure report, no second reconnect, poll runs in the gap", () => {
    connected()
    expect(isSocketOpen()).toBe(true)
    expect(pollWhileSocketDown(10_000, isSocketOpen())).toBe(false)
    away(WAKE_AFTER_HIDDEN_MS)
    expect(isSocketOpen()).toBe(false)
    expect(pollWhileSocketDown(10_000, isSocketOpen())).toBe(10_000)
    vi.advanceTimersByTime(60_000) // the old socket's close event must not schedule a reconnect
    expect(reportNetworkFailure).not.toHaveBeenCalled()
    expect(sockets).toHaveLength(2)
    sockets[1].open()
    expect(isSocketOpen()).toBe(true)
    expect(pollWhileSocketDown(10_000, isSocketOpen())).toBe(false)
    // A late event or open from the retired socket is ignored.
    sockets[0].open()
    expect(sockets).toHaveLength(2)
  })

  it("replaces a socket stuck reconnecting (backoff timer pending) without waiting", () => {
    mount()
    sockets[0].open()
    sockets[0].close() // a real drop: reports failure once and schedules a reconnect
    expect(reportNetworkFailure).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event("online"))
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(30_000)
    expect(sockets).toHaveLength(2) // the pending backoff timer was cancelled
    expect(reportNetworkFailure).toHaveBeenCalledTimes(1)
  })

  it("online triggers the same wake, once per wake", () => {
    connected()
    window.dispatchEvent(new Event("online"))
    expect(sockets).toHaveLength(2)
    window.dispatchEvent(new Event("online")) // repeated within the same wake
    setHidden(false)
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS)
    expect(keys()).toEqual(refetchKeys)
  })

  it("visible and online together after a long absence act once", () => {
    connected()
    away(WAKE_AFTER_HIDDEN_MS)
    window.dispatchEvent(new Event("online"))
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS)
    expect(keys()).toEqual(refetchKeys)
  })

  it("online while hidden waits for the tab to come back, and hidden never acts", () => {
    connected()
    setHidden(true)
    window.dispatchEvent(new Event("online"))
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(1)
    setHidden(false)
    expect(sockets).toHaveLength(2)
  })

  it("leaves no listeners or timers behind when unmounted during a replacement", () => {
    const { unmount } = connected()
    away(WAKE_AFTER_HIDDEN_MS)
    unmount()
    expect(isSocketOpen()).toBe(false)
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS) // the wake's own coalesced refetch may still land
    const timersAfterUnmount = vi.getTimerCount() // QueryClient gc timers etc., none of ours
    const before = sockets.length
    window.dispatchEvent(new Event("online"))
    away(WAKE_AFTER_HIDDEN_MS)
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(before)
    expect(sockets[1].closeCalls).toBe(0) // still connecting: closed once it opens, then quietly
    sockets[1].open()
    expect(sockets[1].closeCalls).toBe(1)
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS)
    expect(vi.getTimerCount()).toBeLessThanOrEqual(timersAfterUnmount)
  })
})

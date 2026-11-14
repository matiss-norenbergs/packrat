import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WSEvent } from "@/types/ws"
import { useDownloadsSocket } from "./useDownloadsSocket"

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
vi.mock("@/lib/notify", () => ({
  notifyDesktop: vi.fn(),
  notifyDesktopAsync: vi.fn(),
  notifyEvent: vi.fn(),
  notifyEventAsync: vi.fn(),
}))
const reportReachable = vi.fn()
const reportNetworkFailure = vi.fn()
vi.mock("@/lib/connection", () => ({
  reportNetworkFailure: (...a: unknown[]) => reportNetworkFailure(...a),
  reportReachable: (...a: unknown[]) => reportReachable(...a),
}))

let client: QueryClient
const mount = () =>
  renderHook(() => useDownloadsSocket(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })

beforeEach(() => {
  vi.useFakeTimers()
  sockets.length = 0
  reportReachable.mockClear()
  reportNetworkFailure.mockClear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("useDownloadsSocket lifecycle", () => {
  it("does not close a socket that is still connecting; closes it once it opens, without reconnecting", () => {
    const { unmount } = mount()
    const s = sockets[0]
    unmount()
    expect(s.closeCalls).toBe(0)

    s.open()
    expect(s.closeCalls).toBe(1)
    // Our own close must not look like a drop: no reachability report, no reconnect, no refetch.
    expect(reportReachable).not.toHaveBeenCalled()
    expect(reportNetworkFailure).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(1)
  })

  it("closes an open socket immediately on unmount", () => {
    const { unmount } = mount()
    sockets[0].open()
    unmount()
    expect(sockets[0].closeCalls).toBe(1)
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(1)
  })

  it("ignores messages that arrive after unmount", () => {
    const spy = vi.spyOn(client, "invalidateQueries")
    const { unmount } = mount()
    const s = sockets[0]
    unmount()
    spy.mockClear()
    s.onEvent({ type: "library_changed", payload: { libraryId: 1, reason: "ghost_created" } })
    expect(spy).not.toHaveBeenCalled()
  })

  it("still delivers messages and reconnects after a drop while mounted", () => {
    const spy = vi.spyOn(client, "invalidateQueries")
    mount()
    const s = sockets[0]
    s.open()
    spy.mockClear()
    s.onEvent({ type: "queue_update", payload: { active: 1, queued: 0 } })
    expect(spy).toHaveBeenCalled()

    s.close()
    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(2)
  })
})

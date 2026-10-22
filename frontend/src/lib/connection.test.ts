import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const probeServer = vi.fn()
const invalidateQueries = vi.fn()

vi.mock("@/lib/server", () => ({
  isDesktop: () => (globalThis as { __desktop?: boolean }).__desktop === true,
  getServerUrl: () => "http://nas:50505",
  probeServer: (url: string) => probeServer(url),
}))
vi.mock("@/lib/queryClient", () => ({ queryClient: { invalidateQueries } }))

async function load() {
  vi.resetModules()
  return await import("@/lib/connection")
}

beforeEach(() => {
  vi.useFakeTimers()
  probeServer.mockReset()
  invalidateQueries.mockReset()
  ;(globalThis as { __desktop?: boolean }).__desktop = true
})
afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { __desktop?: boolean }).__desktop
})

describe("connection monitor", () => {
  it("does nothing on the web", async () => {
    ;(globalThis as { __desktop?: boolean }).__desktop = false
    const c = await load()
    await c.reportNetworkFailure()
    expect(probeServer).not.toHaveBeenCalled()
    expect(c.isOffline()).toBe(false)
  })

  it("ignores a failure when the server still answers its health check", async () => {
    probeServer.mockResolvedValue({ ok: true })
    const c = await load()
    await c.reportNetworkFailure()
    expect(c.isOffline()).toBe(false)
    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it("goes offline when the health check fails, then recovers and refreshes the cache", async () => {
    probeServer.mockResolvedValue({ ok: false, message: "down" })
    const c = await load()
    const listener = vi.fn()
    c.subscribe(listener)

    await c.reportNetworkFailure()
    expect(c.isOffline()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    // Still down on the next probe: stays offline.
    await vi.advanceTimersByTimeAsync(5000)
    expect(c.isOffline()).toBe(true)

    // Server is back: the next probe clears it and invalidates everything.
    probeServer.mockResolvedValue({ ok: true })
    await vi.advanceTimersByTimeAsync(5000)
    expect(c.isOffline()).toBe(false)
    expect(invalidateQueries).toHaveBeenCalledTimes(1)

    // And probing has stopped.
    probeServer.mockClear()
    await vi.advanceTimersByTimeAsync(20000)
    expect(probeServer).not.toHaveBeenCalled()
  })

  it("clears the offline state as soon as any request gets an answer", async () => {
    probeServer.mockResolvedValue({ ok: false, message: "down" })
    const c = await load()
    await c.reportNetworkFailure()
    expect(c.isOffline()).toBe(true)
    c.reportReachable()
    expect(c.isOffline()).toBe(false)
    probeServer.mockClear()
    await vi.advanceTimersByTimeAsync(20000)
    expect(probeServer).not.toHaveBeenCalled()
  })

  it("retryNow probes immediately", async () => {
    probeServer.mockResolvedValue({ ok: false, message: "down" })
    const c = await load()
    await c.reportNetworkFailure()
    probeServer.mockResolvedValue({ ok: true })
    await c.retryNow()
    expect(c.isOffline()).toBe(false)
  })
})

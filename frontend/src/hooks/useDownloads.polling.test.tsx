import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setSocketOpen } from "@/lib/socketState"
import { useDownloads } from "./useDownloads"

const fetchDownloads = vi.fn()
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), fetchDownloads: (...a: unknown[]) => fetchDownloads(...a) }))

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fetchDownloads.mockReset()
  fetchDownloads.mockResolvedValue([])
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => {
  setSocketOpen(false)
})

describe("useDownloads safety-net poll", () => {
  it("does not poll while the socket is open", async () => {
    setSocketOpen(true)
    renderHook(() => useDownloads(), { wrapper })
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(fetchDownloads).toHaveBeenCalledTimes(1)
  })

  it("polls every 10 s while the socket is closed, and stops once it opens", async () => {
    renderHook(() => useDownloads(), { wrapper })
    await act(() => vi.advanceTimersByTimeAsync(30_500))
    expect(fetchDownloads.mock.calls.length).toBeGreaterThanOrEqual(4)
    act(() => setSocketOpen(true))
    const before = fetchDownloads.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(fetchDownloads.mock.calls.length).toBe(before)
  })

  it("resumes polling as soon as the socket drops", async () => {
    setSocketOpen(true)
    renderHook(() => useDownloads(), { wrapper })
    await act(() => vi.advanceTimersByTimeAsync(20_000))
    expect(fetchDownloads).toHaveBeenCalledTimes(1)
    act(() => setSocketOpen(false))
    await act(() => vi.advanceTimersByTimeAsync(10_500))
    expect(fetchDownloads.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { downloadsQueryKey, selectDownloadProgress, useDownloadProgress } from "@/hooks/useDownloads"
import { useDownloadsSocket } from "@/hooks/useDownloadsSocket"
import type { Download } from "@/types/api"
import type { WSEvent } from "@/types/ws"
import { DownloadProgressBar } from "./DownloadProgressBar"

let emit: (e: WSEvent) => void = () => {}
vi.mock("@/lib/ws", () => ({
  connectDownloadsSocket: (onEvent: (e: WSEvent) => void) => {
    emit = onEvent
    return { addEventListener: () => {}, close: () => {} }
  },
}))
vi.mock("@/lib/notify", () => ({ notifyDesktop: vi.fn(), notifyDesktopAsync: vi.fn(), notifyEvent: vi.fn(), notifyEventAsync: vi.fn() }))
vi.mock("@/lib/connection", () => ({ reportNetworkFailure: vi.fn(), reportReachable: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const dl = (id: number, status: Download["status"], percent: number) => ({ id, status, percent }) as unknown as Download

function setup(downloads: Download[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(downloadsQueryKey, downloads)
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe("DownloadProgressBar", () => {
  it.each(["queued", "fetching_metadata"] as const)("renders nothing while %s", (status) => {
    const { wrapper } = setup([dl(1, status, 0)])
    render(<DownloadProgressBar downloadId={1} size="card" />, { wrapper })
    expect(screen.queryByRole("progressbar")).toBeNull()
  })

  it("renders nothing for an unknown download id", () => {
    const { wrapper } = setup([dl(2, "downloading", 50)])
    render(<DownloadProgressBar downloadId={1} size="card" />, { wrapper })
    expect(screen.queryByRole("progressbar")).toBeNull()
  })

  it("fills to the percent while downloading", () => {
    const { wrapper } = setup([dl(1, "downloading", 42)])
    render(<DownloadProgressBar downloadId={1} size="card" />, { wrapper })
    const bar = screen.getByRole("progressbar", { name: "Download progress" })
    expect(bar).toHaveAttribute("aria-valuenow", "42")
    expect(bar).toHaveAttribute("aria-valuemin", "0")
    expect(bar).toHaveAttribute("aria-valuemax", "100")
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("42%")
  })

  it("is full while processing", () => {
    const { wrapper } = setup([dl(1, "processing", 10)])
    render(<DownloadProgressBar downloadId={1} size="card" />, { wrapper })
    const bar = screen.getByRole("progressbar")
    expect(bar).toHaveAttribute("aria-valuenow", "100")
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("100%")
  })

  it("is thinner in the list than on a card, and overlays the bottom edge", () => {
    const { wrapper } = setup([dl(1, "downloading", 5)])
    const { rerender } = render(<DownloadProgressBar downloadId={1} size="card" />, { wrapper })
    expect(screen.getByRole("progressbar")).toHaveClass("absolute", "inset-x-0", "bottom-0", "h-1")
    rerender(<DownloadProgressBar downloadId={1} size="list" />)
    expect(screen.getByRole("progressbar")).toHaveClass("h-0.5")
  })

  it("moves when a WS progress event is patched into the cache", async () => {
    const { wrapper } = setup([dl(1, "downloading", 10)])
    renderHook(() => useDownloadsSocket(), { wrapper })
    render(<DownloadProgressBar downloadId={1} size="card" />, { wrapper })
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "10")
    act(() =>
      emit({ type: "progress", payload: { downloadId: 1, status: "downloading", percent: 73, speedBytesPerSec: 0, etaSeconds: 0, downloadedBytes: 0, totalBytes: 0 } } as WSEvent),
    )
    await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "73"))
  })
})

describe("useDownloadProgress", () => {
  it("selects only the matching download's status and percent", () => {
    expect(selectDownloadProgress([dl(1, "downloading", 5), dl(2, "processing", 9)], 2)).toEqual({ status: "processing", percent: 9 })
    expect(selectDownloadProgress([dl(1, "downloading", 5)], 3)).toBeNull()
  })

  it("keeps its result identity when another download's progress changes", async () => {
    const { client, wrapper } = setup([dl(1, "downloading", 5), dl(2, "downloading", 5)])
    const { result } = renderHook(() => useDownloadProgress(1), { wrapper })
    const first = result.current.data
    expect(first).toEqual({ status: "downloading", percent: 5 })
    act(() => {
      client.setQueryData(downloadsQueryKey, [dl(1, "downloading", 5), dl(2, "downloading", 80)])
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.data).toBe(first)
    act(() => {
      client.setQueryData(downloadsQueryKey, [dl(1, "downloading", 6), dl(2, "downloading", 80)])
    })
    await waitFor(() => expect(result.current.data).toEqual({ status: "downloading", percent: 6 }))
  })
})

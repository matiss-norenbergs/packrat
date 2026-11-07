import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { settingsQueryKey } from "@/hooks/useSettings"
import { DashboardPage } from "@/pages/DashboardPage"
import type { Settings } from "@/types/api"

const STATS = {
  activeDownloads: 0,
  queuedDownloads: 0,
  completedToday: 0,
  libraryVideoCount: 0,
  libraryAudioCount: 0,
  libraryImageCount: 0,
  libraryVideoGhostCount: 0,
  libraryAudioGhostCount: 0,
  libraryImageGhostCount: 0,
  totalStorageBytes: 0,
}

let settingsResponse: () => Promise<{ ok: boolean; status: number; body: unknown }>
let fetchMock: ReturnType<typeof vi.fn>

const paths = () => fetchMock.mock.calls.map(([url]) => String(url).replace(/^.*\/api/, ""))
const requested = (path: string) => paths().includes(path)

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, statusText: String(status), headers: { get: () => null }, json: async () => body }
}

beforeEach(() => {
  settingsResponse = async () => ({ ok: true, status: 200, body: {} })
  fetchMock = vi.fn(async (url: string) => {
    const path = String(url).replace(/^.*\/api/, "")
    if (path === "/settings") {
      const r = await settingsResponse()
      return respond(r.status, r.body)
    }
    if (path === "/stats") return respond(200, STATS)
    if (path === "/stats/library-growth" || path === "/stats/resolution-breakdown") return respond(200, [])
    return respond(200, [])
  })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderDashboard(seed?: Partial<Settings>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (seed) client.setQueryData(settingsQueryKey, seed)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("DashboardPage settings loading", () => {
  it("mounts no block and fetches nothing while the settings are pending", async () => {
    settingsResponse = () => new Promise(() => {})
    renderDashboard()
    expect(screen.getByTestId("dashboard-skeleton")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Dashboard settings" })).toBeDisabled()
    expect(screen.queryByText("Library Growth")).not.toBeInTheDocument()
    expect(screen.queryByText("Items by Resolution")).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 30))
    expect(paths()).toEqual(["/settings"])
  })

  it("renders only the visible blocks once the settings arrive and never requests hidden ones", async () => {
    settingsResponse = async () => ({
      ok: true,
      status: 200,
      body: { dashboardHiddenWidgets: ["downloads", "library", "libraryGrowth", "resolutions", "topArtists", "topTags"] },
    })
    renderDashboard()
    await screen.findByText("Media Types")
    expect(screen.getByText("Storage")).toBeInTheDocument()
    expect(screen.queryByTestId("dashboard-skeleton")).not.toBeInTheDocument()
    expect(screen.queryByText("Library Growth")).not.toBeInTheDocument()
    expect(screen.queryByText("Items by Resolution")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Dashboard settings" })).toBeEnabled()
    await waitFor(() => expect(requested("/stats")).toBe(true)) // the two visible charts share it
    expect(requested("/stats/library-growth")).toBe(false)
    expect(requested("/stats/resolution-breakdown")).toBe(false)
    expect(requested("/artists")).toBe(false)
    expect(requested("/tags")).toBe(false)
  })

  it("requests no stats at all when every stats block is hidden", async () => {
    settingsResponse = async () => ({
      ok: true,
      status: 200,
      body: { dashboardHiddenWidgets: ["downloads", "library", "libraryGrowth", "mediaTypes", "resolutions", "storage", "topArtists", "topTags"] },
    })
    renderDashboard()
    await screen.findByText(/All dashboard cards are hidden/)
    expect(paths()).toEqual(["/settings"])
  })

  it("falls back to showing every block when the settings request fails", async () => {
    settingsResponse = async () => ({ ok: false, status: 500, body: { error: "boom" } })
    renderDashboard()
    await screen.findByText("Library Growth")
    expect(screen.getByText("Items by Resolution")).toBeInTheDocument()
    expect(screen.getByText("Media Types")).toBeInTheDocument()
    expect(screen.queryByTestId("dashboard-skeleton")).not.toBeInTheDocument()
    await waitFor(() => expect(requested("/stats/library-growth")).toBe(true))
    expect(requested("/stats/resolution-breakdown")).toBe(true)
  })

  it("renders the real blocks on first paint when the settings are already cached", () => {
    settingsResponse = () => new Promise(() => {})
    renderDashboard({ dashboardHiddenWidgets: ["topArtists"] })
    expect(screen.queryByTestId("dashboard-skeleton")).not.toBeInTheDocument()
    expect(screen.getByText("Library Growth")).toBeInTheDocument()
    expect(screen.queryByText(/Top Artists/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Dashboard settings" })).toBeEnabled()
  })
})

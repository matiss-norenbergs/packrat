import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SettingsTabLoader } from "@/components/settings/SettingsTabLoader"
import { callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"
import type { Settings } from "@/types/api"

const SETTINGS = { maxConcurrentDownloads: 3 } as Settings

const body = (s: Settings) => <p>Max downloads: {s.maxConcurrentDownloads}</p>

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("SettingsTabLoader", () => {
  it("shows the skeleton while the settings load", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
    const { container } = renderWithProviders(<SettingsTabLoader skeletonClassName="h-7 w-full">{body}</SettingsTabLoader>)

    const skeleton = container.querySelector('[data-slot="skeleton"]')
    expect(skeleton).toHaveClass("h-7")
    expect(screen.queryByText(/Max downloads/)).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("renders the body with the loaded settings", async () => {
    mockFetch(() => ({ status: 200, body: SETTINGS }))
    const { container } = renderWithProviders(<SettingsTabLoader>{body}</SettingsTabLoader>)

    expect(await screen.findByText("Max downloads: 3")).toBeInTheDocument()
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
  })

  it("shows an error with Retry when the settings can't be loaded, and Retry recovers", async () => {
    let healthy = false
    const fetchMock = mockFetch(() => (healthy ? { status: 200, body: SETTINGS } : { status: 500, body: { error: "boom" } }))
    const { container } = renderWithProviders(<SettingsTabLoader>{body}</SettingsTabLoader>)

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the settings")
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
    expect(screen.queryByText(/Max downloads/)).not.toBeInTheDocument()
    expect(callsTo(fetchMock, "/settings")).toHaveLength(1)

    healthy = true
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }))

    expect(await screen.findByText("Max downloads: 3")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    await waitFor(() => expect(callsTo(fetchMock, "/settings")).toHaveLength(2))
  })

  it("stays on a failing Retry instead of rendering the body", async () => {
    const fetchMock = mockFetch(() => ({ status: 500, body: { error: "boom" } }))
    renderWithProviders(<SettingsTabLoader>{body}</SettingsTabLoader>)

    await userEvent.setup().click(await screen.findByRole("button", { name: "Retry" }))

    await waitFor(() => expect(callsTo(fetchMock, "/settings")).toHaveLength(2))
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(screen.queryByText(/Max downloads/)).not.toBeInTheDocument()
  })
})

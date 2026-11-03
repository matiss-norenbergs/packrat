import { cleanup, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mockFetch, renderWithProviders } from "@/test/mockApi"

let desktop = false
vi.mock("@/lib/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server")>()),
  isDesktop: () => desktop,
}))
const getVersion = vi.fn()
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => getVersion() }))
// The switcher has its own tests and needs profiles; keep this file about the version rows.
vi.mock("@/components/ServerSwitcher", () => ({ SidebarServerSwitcher: () => null }))
vi.mock("@/components/sidebar/HostActionsMenu", () => ({ HostActionsMenu: () => null }))

import { SidebarContent } from "@/components/sidebar/Sidebar"

beforeEach(() => {
  getVersion.mockReset()
  getVersion.mockResolvedValue("0.18.2")
  mockFetch((url) => {
    if (url.endsWith("/version")) {
      return { status: 200, body: { version: "1.4.0", latestVersion: "1.5.0", updateAvailable: true } }
    }
    return { status: 200, body: {} }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("sidebar version row", () => {
  it("web: shows Packrat with the server version, update dot and releases link", async () => {
    desktop = false
    renderWithProviders(<SidebarContent />)
    const version = await screen.findByText("v1.4.0")
    const row = version.closest("a")
    expect(row).toHaveTextContent("Packrat")
    expect(row).toHaveAttribute("href", expect.stringContaining("/releases/latest"))
    expect(row?.querySelector(".bg-warning")).not.toBeNull()
    expect(screen.queryByText("Desktop")).not.toBeInTheDocument()
    expect(getVersion).not.toHaveBeenCalled()
  })

  it("desktop: shows Desktop with the app version, no dot and no link", async () => {
    desktop = true
    renderWithProviders(<SidebarContent />)
    const version = await screen.findByText("v0.18.2")
    const row = version.parentElement as HTMLElement
    expect(row).toHaveTextContent("Desktop")
    expect(row.tagName).toBe("DIV")
    expect(row.closest("a")).toBeNull()
    expect(row.querySelector(".bg-warning")).toBeNull()
    expect(screen.queryByText("v1.4.0")).not.toBeInTheDocument()
  })

  it("desktop: renders nothing when the app version can't be read", async () => {
    desktop = true
    getVersion.mockImplementation(() => {
      throw new Error("nope")
    })
    renderWithProviders(<SidebarContent />)
    await screen.findByText("yt-dlp").catch(() => {})
    expect(screen.queryByText("Desktop")).not.toBeInTheDocument()
  })
})

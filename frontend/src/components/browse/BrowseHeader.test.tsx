import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BrowseHeader } from "@/components/browse/BrowseHeader"
import { TooltipProvider } from "@/components/ui/tooltip"
import { activateProfile, addProfile, getActiveProfile } from "@/lib/serverProfiles"
import { callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"
import { enterTauri, leaveTauri } from "@/test/tauriShell"

const reloadApp = vi.fn()
vi.mock("@/lib/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server")>()),
  reloadApp: () => reloadApp(),
}))

// jsdom lacks these, and Radix's menu calls them.
beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  window.HTMLElement.prototype.hasPointerCapture = vi.fn()
  window.HTMLElement.prototype.releasePointerCapture = vi.fn()
  localStorage.clear()
  sessionStorage.clear()
  reloadApp.mockReset()
})
afterEach(() => {
  cleanup()
  leaveTauri()
  vi.unstubAllGlobals()
})

function setupServers() {
  const home = addProfile("http://nas:50505", "Home")
  const work = addProfile("https://packrat.work.example", "Work")
  activateProfile(home.id)
  return { home, work }
}

const renderHeader = () =>
  renderWithProviders(
    <TooltipProvider>
      <BrowseHeader />
    </TooltipProvider>,
    "/browse",
  )

describe("BrowseHeader in the Android app", () => {
  beforeEach(() => enterTauri("android"))

  it("has the app menu instead of the Manage link, and keeps search and the logo", () => {
    setupServers()
    mockFetch(() => ({ status: 200 }))
    renderHeader()
    expect(screen.getByRole("button", { name: "App menu" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "" })).toBeNull()
    expect(document.querySelector('a[href="/"]')).toBeNull()
    expect(screen.getByRole("link", { name: /Packrat/ })).toHaveAttribute("href", "/browse")
    expect(document.querySelector(".lucide-search")).not.toBeNull()
  })

  it("Change server lists the saved servers and switches with the existing switcher", async () => {
    const { work } = setupServers()
    mockFetch(() => ({ status: 200 }))
    renderHeader()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "App menu" }))
    expect(await screen.findByText("Home", { selector: "div" })).toBeInTheDocument() // the current server, as the label
    await user.click(screen.getByRole("menuitem", { name: "Change server" }))
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).toBeNull() // the list replaced the main entries
    await user.click(await screen.findByRole("menuitem", { name: /Work/ }))
    expect(getActiveProfile()?.id).toBe(work.id)
    expect(reloadApp).toHaveBeenCalledOnce()
  })

  it("Change server offers Add server… but not Manage servers (no Settings in the app)", async () => {
    setupServers()
    mockFetch(() => ({ status: 200 }))
    renderHeader()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "App menu" }))
    await user.click(await screen.findByRole("menuitem", { name: "Change server" }))
    expect(await screen.findByRole("menuitem", { name: "Add server…" })).toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Manage servers" })).toBeNull()
    await user.click(screen.getByRole("menuitem", { name: "Back" }))
    expect(await screen.findByRole("menuitem", { name: "Sign out" })).toBeInTheDocument()
  })

  it("Sign out logs out on the server and drops this server's login", async () => {
    const { home } = setupServers()
    localStorage.setItem(`packrat.token.${home.id}`, "home-token")
    const fetchMock = mockFetch(() => ({ status: 204 }))
    renderHeader()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "App menu" }))
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }))
    await waitFor(() => expect(callsTo(fetchMock, "/api/auth/logout")).toHaveLength(1))
    await waitFor(() => expect(localStorage.getItem(`packrat.token.${home.id}`)).toBeNull())
  })
})

describe.each([
  ["web", () => {}],
  ["desktop app", () => enterTauri("desktop")],
])("BrowseHeader on the %s (unchanged)", (_name, enter) => {
  beforeEach(() => enter())

  it("has the Manage link and no app menu", () => {
    setupServers()
    mockFetch(() => ({ status: 200 }))
    renderHeader()
    expect(document.querySelector('a[href="/"]')).not.toBeNull()
    expect(screen.queryByRole("button", { name: "App menu" })).toBeNull()
  })
})

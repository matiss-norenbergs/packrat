import { act, cleanup, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SidebarServerSwitcher } from "@/components/ServerSwitcher"
import { renameProfile } from "@/lib/server"
import { activateProfile, addProfile, getActiveProfile, isAddingServer } from "@/lib/serverProfiles"
import { mockFetch, renderWithProviders } from "@/test/mockApi"

const reloadApp = vi.fn()
vi.mock("@/lib/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server")>()),
  reloadApp: () => reloadApp(),
  isDesktop: () => true,
}))

// jsdom lacks these, and Radix's menu calls them.
beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  window.HTMLElement.prototype.hasPointerCapture = vi.fn()
  window.HTMLElement.prototype.releasePointerCapture = vi.fn()
  localStorage.clear()
  sessionStorage.clear()
  reloadApp.mockReset()
  mockFetch(() => ({ status: 200, body: { version: "1.4.0", latestVersion: "1.4.0", updateAvailable: false } }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup() {
  const home = addProfile("http://nas:50505", "Home")
  const work = addProfile("https://packrat.work.example", "Work")
  activateProfile(home.id)
  return { home, work }
}

describe("SidebarServerSwitcher", () => {
  it("shows the current server's name and version", async () => {
    setup()
    renderWithProviders(<SidebarServerSwitcher onManage={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Switch server" })).toHaveTextContent("Home")
    expect(await screen.findByText("v1.4.0")).toBeInTheDocument()
  })

  it("follows a rename of the current server without a reload", async () => {
    const { home } = setup()
    renderWithProviders(<SidebarServerSwitcher onManage={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Switch server" })).toHaveTextContent("Home")
    act(() => renameProfile(home.id, "Basement NAS"))
    expect(screen.getByRole("button", { name: "Switch server" })).toHaveTextContent("Basement NAS")
  })

  it("lists the servers with the current one marked, plus Add and Manage", async () => {
    setup()
    renderWithProviders(<SidebarServerSwitcher onManage={vi.fn()} />)
    await userEvent.setup().click(screen.getByRole("button", { name: "Switch server" }))
    const home = await screen.findByRole("menuitem", { name: /Home/ })
    expect(home).toContainElement(screen.getByLabelText("Current server"))
    expect(screen.getAllByLabelText("Current server")).toHaveLength(1)
    expect(screen.getByRole("menuitem", { name: /Work/ })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Add server…" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Manage servers" })).toBeInTheDocument()
  })

  it("switching activates the chosen profile and reloads, without touching tokens", async () => {
    const { work } = setup()
    localStorage.setItem(`packrat.token.${work.id}`, "work-token")
    renderWithProviders(<SidebarServerSwitcher onManage={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Switch server" }))
    await user.click(await screen.findByRole("menuitem", { name: /Work/ }))
    expect(getActiveProfile()?.id).toBe(work.id)
    expect(reloadApp).toHaveBeenCalledOnce()
    expect(localStorage.getItem(`packrat.token.${work.id}`)).toBe("work-token")
  })

  it("choosing the current server does nothing", async () => {
    setup()
    renderWithProviders(<SidebarServerSwitcher onManage={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Switch server" }))
    await user.click(await screen.findByRole("menuitem", { name: /Home/ }))
    expect(reloadApp).not.toHaveBeenCalled()
  })

  it("Add server… raises the connect screen flag and reloads, keeping the current server", async () => {
    const { home } = setup()
    renderWithProviders(<SidebarServerSwitcher onManage={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Switch server" }))
    await user.click(await screen.findByRole("menuitem", { name: "Add server…" }))
    expect(isAddingServer()).toBe(true)
    expect(reloadApp).toHaveBeenCalledOnce()
    expect(getActiveProfile()?.id).toBe(home.id)
  })

  it("Manage servers calls back", async () => {
    setup()
    const onManage = vi.fn()
    renderWithProviders(<SidebarServerSwitcher onManage={onManage} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Switch server" }))
    await user.click(await screen.findByRole("menuitem", { name: "Manage servers" }))
    expect(onManage).toHaveBeenCalledOnce()
  })
})

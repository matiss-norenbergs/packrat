import { cleanup, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ServersSection } from "@/components/settings/ServersSection"
import { activateProfile, addProfile, getActiveProfile, getProfiles, isAddingServer } from "@/lib/serverProfiles"
import { mockFetch, renderWithProviders } from "@/test/mockApi"

const reloadApp = vi.fn()
vi.mock("@/lib/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server")>()),
  reloadApp: () => reloadApp(),
}))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  reloadApp.mockReset()
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

const health = (ok: boolean) =>
  mockFetch((url) => (url.endsWith("/api/health") && ok ? { status: 200, body: { status: "ok" } } : { status: 404 }))

async function editAddress(name: string, address: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: `Edit ${name}` }))
  const field = screen.getByLabelText("Address")
  await user.clear(field)
  await user.type(field, address)
  await user.click(screen.getByRole("button", { name: "Save" }))
}

describe("ServersSection", () => {
  it("lists each server with its address, marks the current one", () => {
    setup()
    renderWithProviders(<ServersSection />)
    const rows = screen.getAllByRole("row").slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText("Home")).toBeInTheDocument()
    expect(within(rows[0]).getByText("Current")).toBeInTheDocument()
    expect(within(rows[0]).getByText("http://nas:50505")).toBeInTheDocument()
    expect(within(rows[0]).getByText("Now")).toBeInTheDocument()
    expect(within(rows[1]).getByText("Work")).toBeInTheDocument()
    expect(within(rows[1]).queryByText("Current")).toBeNull()
  })

  it("has the Name / Address / Last used columns with an actions column", () => {
    setup()
    renderWithProviders(<ServersSection />)
    const headers = screen.getAllByRole("columnheader")
    expect(headers.map((h) => h.textContent)).toEqual(["Name", "Address", "Last used", ""])
    expect(headers[2]).toHaveClass("text-center")
    expect(headers[3]).toHaveClass("w-24")
    const cells = within(screen.getAllByRole("row")[2]).getAllByRole("cell")
    expect(cells[1]).toHaveClass("break-all", "font-mono", "text-xs")
    expect(cells[2]).toHaveClass("text-center", "whitespace-nowrap")
    expect(within(cells[2]).getByTitle(/./)).toBeInTheDocument() // full date on hover
    expect(within(cells[3]).getByRole("button", { name: "Edit Work" })).toHaveAttribute("title", "Edit")
    expect(within(cells[3]).getByRole("button", { name: "Remove Work" })).toHaveAttribute("title", "Remove")
    expect(screen.getByRole("table").parentElement).toHaveClass("max-h-80", "overflow-auto")
  })

  it("shows a message instead of the table when there are no saved servers", () => {
    renderWithProviders(<ServersSection />)
    expect(screen.getByText("No saved servers.")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.getByRole("button", { name: "Add server…" })).toBeInTheDocument()
  })

  it("opens the edit dialog for the clicked row only", async () => {
    setup()
    renderWithProviders(<ServersSection />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Edit Work" }))
    expect(screen.getByLabelText("Name")).toHaveValue("Work")
    expect(screen.getByLabelText("Address")).toHaveValue("https://packrat.work.example")
  })

  it("renames a server without probing it", async () => {
    const { work } = setup()
    const fetchMock = health(true)
    renderWithProviders(<ServersSection />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Edit Work" }))
    const name = screen.getByLabelText("Name")
    await user.clear(name)
    await user.type(name, "Office")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(getProfiles().find((p) => p.id === work.id)?.name).toBe("Office")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(reloadApp).not.toHaveBeenCalled()
    expect(await screen.findByText("Office")).toBeInTheDocument()
  })

  it("re-probes a new address before saving it, and keeps the old one if it fails", async () => {
    const { work } = setup()
    health(false)
    renderWithProviders(<ServersSection />)
    await editAddress("Work", "elsewhere:1")
    expect(await screen.findByText(/Is this a Packrat server/)).toBeInTheDocument()
    expect(getProfiles().find((p) => p.id === work.id)?.url).toBe("https://packrat.work.example")
  })

  it("saves a reachable new address and drops that server's token", async () => {
    const { work } = setup()
    localStorage.setItem(`packrat.token.${work.id}`, "old")
    const fetchMock = health(true)
    renderWithProviders(<ServersSection />)
    await editAddress("Work", "elsewhere:1")
    await waitFor(() => expect(getProfiles().find((p) => p.id === work.id)?.url).toBe("http://elsewhere:1"))
    expect(fetchMock).toHaveBeenCalledWith("http://elsewhere:1/api/health", expect.anything())
    // The old server is told to end that login, with that server's token; the new one never sees it.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://packrat.work.example/api/auth/logout",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer old" } }),
    )
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("http://elsewhere:1")).map(([url]) => url)).toEqual([
      "http://elsewhere:1/api/health",
    ])
    expect(localStorage.getItem(`packrat.token.${work.id}`)).toBeNull()
    expect(reloadApp).not.toHaveBeenCalled() // not the active server
  })

  it("reloads when the active server's address changes", async () => {
    setup()
    health(true)
    renderWithProviders(<ServersSection />)
    await editAddress("Home", "nas2:50505")
    await waitFor(() => expect(reloadApp).toHaveBeenCalledOnce())
  })

  it("refuses an address another server already uses", async () => {
    setup()
    const fetchMock = health(true)
    renderWithProviders(<ServersSection />)
    await editAddress("Work", "nas:50505")
    expect(await screen.findByText(/already saved as "Home"/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("asks before removing, then deletes the server and its token", async () => {
    const { work } = setup()
    localStorage.setItem(`packrat.token.${work.id}`, "work-token")
    const fetchMock = mockFetch(() => ({ status: 204 }))
    renderWithProviders(<ServersSection />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Remove Work" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Remove Work?")).toBeInTheDocument()
    expect(getProfiles()).toHaveLength(2) // nothing yet
    await user.click(within(dialog).getByRole("button", { name: "Remove" }))
    await waitFor(() => expect(getProfiles().map((p) => p.name)).toEqual(["Home"]))
    expect(fetchMock).toHaveBeenCalledWith(
      "https://packrat.work.example/api/auth/logout",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer work-token" } }),
    )
    expect(localStorage.getItem(`packrat.token.${work.id}`)).toBeNull()
    expect(getActiveProfile()?.name).toBe("Home")
    expect(reloadApp).not.toHaveBeenCalled()
  })

  it("removing the active server leaves none active and reloads to the connect screen", async () => {
    setup()
    renderWithProviders(<ServersSection />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Remove Home" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/connect screen/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Remove" }))
    await waitFor(() => expect(reloadApp).toHaveBeenCalledOnce())
    expect(getActiveProfile()).toBeNull()
    expect(getProfiles().map((p) => p.name)).toEqual(["Work"])
  })

  it("Add server… opens the connect screen", async () => {
    setup()
    renderWithProviders(<ServersSection />)
    await userEvent.setup().click(screen.getByRole("button", { name: /Add server/ }))
    expect(isAddingServer()).toBe(true)
    expect(reloadApp).toHaveBeenCalledOnce()
  })
})

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LogsPage } from "@/pages/LogsPage"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import type { Settings, SystemEvent, SystemEventFacets } from "@/types/api"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

beforeEach(() => {
  // Radix menus and the table need these in jsdom.
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.scrollTo ??= () => {} // the tab list scrolls the active tab into view
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ev = (id: number, over: Partial<SystemEvent> = {}): SystemEvent => ({
  id,
  createdAt: "2026-10-30T12:34:56Z",
  level: "info",
  category: "startup",
  message: `Event ${id}`,
  details: null,
  ...over,
})

const FACETS: SystemEventFacets = {
  levels: [
    { value: "error", count: 1 },
    { value: "info", count: 5 },
    { value: "warning", count: 2 },
  ],
  categories: [
    { value: "backup", count: 2 },
    { value: "startup", count: 6 },
  ],
}

interface Server {
  events: SystemEvent[]
  total: number
  systemOn: boolean
}

// A fake server that records every system-events list URL it was asked for.
function serve(over: Partial<Server> = {}) {
  const state: Server = { events: [ev(1), ev(2), ev(3, { level: "warning", category: "backup", details: { count: 3, nested: { a: 1 } } })], total: 3, systemOn: true, ...over }
  const listUrls: string[] = []
  const deletes: unknown[] = []
  const fn = mockFetch((url, init) => {
    const path = url.replace(/^.*\/api/, "")
    if (path === "/settings") return { status: 200, body: { featureSystemEventsEnabled: state.systemOn } as Settings }
    if (path === "/logs") return { status: 200, body: [] }
    if (path === "/system-events/facets") return { status: 200, body: FACETS }
    if (path.startsWith("/system-events") && init.method === "DELETE") {
      deletes.push(JSON.parse(init.body as string))
      return { status: 200, body: { deleted: (deletes[deletes.length - 1] as { ids: number[] }).ids.length } }
    }
    if (path.startsWith("/system-events")) {
      listUrls.push(path)
      return { status: 200, body: { items: state.events, total: state.total, page: 1, pageSize: 50 } }
    }
    return { status: 404 }
  })
  return { fn, state, listUrls, deletes, lastUrl: () => new URL(listUrls[listUrls.length - 1], "http://x") }
}

// The filter dropdown's trigger (a column header's sort button can share its name).
const filterButton = (name: string) => screen.getAllByRole("button", { name }).find((b) => b.getAttribute("aria-haspopup") === "menu")!
const renderSystem = () => renderWithProviders(<LogsPage />, "/?view=system")
const params = (s: { lastUrl: () => URL }) => Object.fromEntries(s.lastUrl().searchParams)

describe("LogsPage System view", () => {
  it("is hidden while the system log is switched off", async () => {
    const s = serve({ systemOn: false })
    renderWithProviders(<LogsPage />, "/?view=system")
    // The downloads view shows instead, with no tabs.
    expect(await screen.findByText(/yt-dlp command, exit code/)).toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: "System" })).not.toBeInTheDocument()
    expect(s.listUrls).toHaveLength(0)
  })

  it("offers the System tab when the switch is on, and loads the first page newest first", async () => {
    const s = serve()
    renderWithProviders(<LogsPage />)
    const tab = await screen.findByRole("tab", { name: "System" })
    expect(screen.getByRole("tab", { name: "Downloads" })).toBeInTheDocument()
    await userEvent.setup().click(tab)

    expect(await screen.findByText("Event 1")).toBeInTheDocument()
    expect(params(s)).toEqual({ sort: "createdAt", dir: "desc", page: "1", pageSize: "50" })
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent)
    expect(headers).toEqual(["", "Time", "Level", "Category", "Message"])
    // Level badge, capitalised category, count footer.
    const warningRow = screen.getByText("Event 3").closest("tr")!
    expect(within(warningRow).getByText("warning")).toBeInTheDocument()
    expect(screen.getByText(/3 events/)).toBeInTheDocument()
  })

  it("sends the filters, search, dates and sort to the server, and resets to page 1 on a filter change", async () => {
    const s = serve({ events: Array.from({ length: 50 }, (_, i) => ev(i + 1)), total: 120 })
    renderSystem()
    await screen.findByText("Event 1")
    const user = userEvent.setup()

    // Page 2.
    await user.click(screen.getByRole("button", { name: /next/i }))
    await waitFor(() => expect(params(s).page).toBe("2"))

    // A filter change goes back to page 1.
    await user.click(filterButton("Level"))
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /warning/ }))
    await waitFor(() => expect(params(s)).toMatchObject({ level: "warning", page: "1" }))
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /error/ }))
    await waitFor(() => expect(params(s).level).toBe("warning,error"))
    await user.keyboard("{Escape}")

    await user.click(filterButton("Category"))
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /backup/ }))
    await waitFor(() => expect(params(s).category).toBe("backup"))
    await user.keyboard("{Escape}")

    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-03-01" } })
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-03-04" } })
    await waitFor(() => {
      const p = params(s)
      expect(new Date(p.from).getTime()).toBe(new Date(2026, 2, 1).getTime())
      expect(new Date(p.to).getTime()).toBe(new Date(2026, 2, 4, 23, 59, 59).getTime())
    })

    await user.type(screen.getByPlaceholderText("Search messages…"), "backup failed")
    await waitFor(() => expect(params(s).q).toBe("backup failed"), { timeout: 2000 })
    expect(params(s)).toMatchObject({ level: "warning,error", category: "backup", page: "1", sort: "createdAt", dir: "desc" })

    // Sorting by a column sends the server's sort key.
    await user.click(within(screen.getByRole("columnheader", { name: "Level" })).getByRole("button"))
    await waitFor(() => expect(params(s)).toMatchObject({ sort: "level", dir: "asc", page: "1" }))
  })

  it("offers Clear filters only while a filter is active, and clears them all", async () => {
    const s = serve()
    renderWithProviders(<LogsPage />, "/?view=system&level=error&q=boom")
    await screen.findByText("Event 1")
    expect(params(s)).toMatchObject({ level: "error", q: "boom" })
    await userEvent.setup().click(screen.getByRole("button", { name: "Clear filters" }))
    await waitFor(() => expect(params(s).level).toBeUndefined())
    expect(params(s).q).toBeUndefined()
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument()
  })

  it("shows different text for no events at all and for no events matching the filters", async () => {
    serve({ events: [], total: 0 })
    renderSystem()
    expect(await screen.findByText(/No system events recorded yet/)).toBeInTheDocument()
    cleanup()

    serve({ events: [], total: 0 })
    renderWithProviders(<LogsPage />, "/?view=system&level=error")
    expect(await screen.findByText("No events match these filters.")).toBeInTheDocument()
  })

  it("Delete asks for confirmation with the count, then deletes by ids and refetches", async () => {
    const s = serve()
    renderSystem()
    await screen.findByText("Event 1")
    const user = userEvent.setup()
    const del = screen.getByRole("button", { name: "Delete" })
    expect(del).toBeDisabled()

    await user.click(screen.getByRole("checkbox", { name: /Select event 1:/ }))
    await user.click(screen.getByRole("checkbox", { name: /Select event 3:/ }))
    expect(del).toBeEnabled()
    const listsBefore = s.listUrls.length
    await user.click(del)

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Delete 2 events?")).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(s.deletes).toHaveLength(0)

    await user.click(del)
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(s.deletes).toHaveLength(1))
    expect(s.deletes[0]).toEqual({ ids: [1, 3] })
    // The list is refetched and the selection is gone.
    await waitFor(() => expect(s.listUrls.length).toBeGreaterThan(listsBefore))
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled())
  })

  it("opens a details dialog on double-click with the pretty-printed JSON", async () => {
    serve()
    renderSystem()
    const row = (await screen.findByText("Event 3")).closest("tr")!
    fireEvent.doubleClick(row)

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Event 3")).toBeInTheDocument()
    expect(within(dialog).getByText("Category:").textContent).toBe("Category: backup")
    expect(within(dialog).getByText("Level:").textContent).toBe("Level: warning")
    const pre = dialog.querySelector("pre")!
    expect(pre.textContent).toBe(JSON.stringify({ count: 3, nested: { a: 1 } }, null, 2))
    expect(within(dialog).getByRole("button", { name: "Copy details" })).toBeInTheDocument()
  })

  it("says so in the details dialog when an event has no details", async () => {
    serve()
    renderSystem()
    fireEvent.doubleClick((await screen.findByText("Event 1")).closest("tr")!)
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("This event has no details.")).toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: "Copy details" })).not.toBeInTheDocument()
  })
})

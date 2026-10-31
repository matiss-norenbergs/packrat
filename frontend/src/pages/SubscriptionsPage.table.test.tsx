import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SubscriptionsPage } from "@/pages/SubscriptionsPage"
import { bodyOf, callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"
import type { Subscription } from "@/types/api"

// Defaults to the real hook; the stale-closure test swaps in one that hands out a new `mutate` every render.
const updateHook = vi.hoisted(() => ({ override: null as null | (() => unknown) }))
vi.mock("@/hooks/useSubscriptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useSubscriptions")>()
  return {
    ...actual,
    useUpdateSubscription: () => (updateHook.override ? updateHook.override() : actual.useUpdateSubscription()),
  }
})

beforeEach(() => {
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
  updateHook.override = null
  vi.unstubAllGlobals()
})

const CHECKED = "2026-10-30T12:34:56Z"

const sub = (id: number, title: string, over: Partial<Subscription> = {}): Subscription => ({
  id,
  url: `https://example.com/${title.toLowerCase().replace(/\s+/g, "-")}`,
  title,
  mediaType: "video",
  collectionId: 7,
  collectionName: "Music",
  tags: ["a", "b"],
  autoDownload: false,
  generateNfo: true,
  checkIntervalHours: 6,
  enabled: true,
  lastCheckedAt: CHECKED,
  lastCheckError: null,
  knownEntryCount: 4,
  unseenEntryCount: 0,
  createdAt: "",
  ...over,
})

function serve(subs: Subscription[]) {
  return mockFetch((url, init) => {
    if (/\/subscriptions\/\d+\/check$/.test(url) && init.method === "POST") return { status: 200, body: { newItemsFound: 0 } }
    if (/\/subscriptions\/\d+$/.test(url) && init.method === "PATCH") return { status: 200, body: {} }
    if (/\/subscriptions\/\d+$/.test(url) && init.method === "DELETE") return { status: 204 }
    if (url.endsWith("/subscriptions")) return { status: 200, body: subs }
    if (/\/subscriptions\/\d+\/entries$/.test(url)) return { status: 200, body: [] }
    if (url.endsWith("/collections") || url.endsWith("/tags")) return { status: 200, body: [] }
    return { status: 404 }
  })
}

const renderPage = () => renderWithProviders(<SubscriptionsPage />)

const row = (title: string) => screen.getByText(title).closest("tr")!
const select = (title: string) => {
  fireEvent.mouseDown(row(title))
  fireEvent.mouseUp(window)
}
const isSelected = (title: string) => row(title).getAttribute("data-state") === "selected"
// "Known items" is also a sortable column header, so skip buttons inside the table.
const toolbarButton = (name: string) => screen.getAllByRole("button", { name }).find((b) => !b.closest("table"))!

describe("SubscriptionsPage table", () => {
  it("renders every column: title + url, collection fallback, known items, last checked, auto-download, enabled", async () => {
    serve([
      sub(1, "Alpha", { unseenEntryCount: 3, autoDownload: true, knownEntryCount: 12 }),
      sub(2, "Beta", { collectionName: null, collectionId: null, lastCheckedAt: null, enabled: false }),
      sub(3, "Gamma", { lastCheckError: "boom" }),
    ])
    renderPage()
    await screen.findByText("Alpha")
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "",
      "Title",
      "Collection",
      "Known items",
      "Last checked",
      "Auto-download",
      "Enabled",
    ])

    const alpha = within(row("Alpha"))
    expect(alpha.getByText("https://example.com/alpha")).toBeInTheDocument()
    expect(alpha.getByText("Music")).toBeInTheDocument()
    expect(alpha.getByText("+3 new")).toBeInTheDocument()
    expect(alpha.getByText(new Date(CHECKED).toLocaleString())).toBeInTheDocument()
    expect(alpha.getByText("On")).toBeInTheDocument()
    expect(alpha.getByRole("switch")).toBeChecked()
    expect(alpha.queryByLabelText("Last check failed")).toBeNull()

    const beta = within(row("Beta"))
    expect(beta.getByText("Uncategorized")).toBeInTheDocument()
    expect(beta.getByText("Never")).toBeInTheDocument()
    expect(beta.getByText("Off")).toBeInTheDocument()
    expect(beta.queryByText(/new$/)).toBeNull()
    expect(beta.getByRole("switch")).not.toBeChecked()

    expect(within(row("Gamma")).getByLabelText("Last check failed")).toBeInTheDocument()
    expect(screen.getByText("3 subscriptions")).toBeInTheDocument()
  })

  it("keeps the numeric, date, status and switch columns aligned like before", async () => {
    serve([sub(1, "Alpha")])
    renderPage()
    await screen.findByText("Alpha")
    const headers = screen.getAllByRole("columnheader")
    const classes = (i: number) => headers[i].className
    expect(classes(3)).toContain("text-right")
    expect(classes(4)).toContain("text-center")
    expect(classes(5)).toContain("text-center")
    expect(classes(6)).toContain("text-center")
    expect(classes(1)).not.toMatch(/text-(right|center)/)
    expect(within(row("Alpha")).getByText("https://example.com/alpha").closest("td")).not.toHaveClass("max-w-64")
  })

  it("searches by title and by url, case-insensitively", async () => {
    serve([sub(1, "Alpha"), sub(2, "Beta", { url: "https://videos.test/zeta" }), sub(3, "Gamma")])
    renderPage()
    await screen.findByText("Alpha")
    const box = screen.getByPlaceholderText("Search subscriptions…")

    fireEvent.change(box, { target: { value: "ALP" } })
    await waitFor(() => expect(screen.queryByText("Beta")).toBeNull())
    expect(screen.getByText("Alpha")).toBeInTheDocument()
    expect(screen.getByText("1 subscription")).toBeInTheDocument()

    fireEvent.change(box, { target: { value: "VIDEOS.test" } })
    await screen.findByText("Beta")
    expect(screen.queryByText("Alpha")).toBeNull()
  })

  it("shows the empty and no-match messages with a 0 subscriptions footer", async () => {
    serve([])
    renderPage()
    expect(await screen.findByText(/Nothing here yet — add a channel or playlist URL/)).toBeInTheDocument()
    expect(screen.getByText("0 subscriptions")).toBeInTheDocument()
    cleanup()

    serve([sub(1, "Alpha")])
    renderPage()
    await screen.findByText("Alpha")
    fireEvent.change(screen.getByPlaceholderText("Search subscriptions…"), { target: { value: "zzz" } })
    expect(await screen.findByText(/No subscriptions match "zzz"/)).toBeInTheDocument()
    expect(screen.getByText("0 subscriptions")).toBeInTheDocument()
  })

  it("selects with a plain click, appends the selected count to the footer, and clears on search", async () => {
    serve([sub(1, "Alpha"), sub(2, "Beta")])
    renderPage()
    await screen.findByText("Alpha")
    select("Alpha")
    expect(isSelected("Alpha")).toBe(true)
    expect(screen.getByText(/2 subscriptions · 1 selected/)).toBeInTheDocument()
    fireEvent.mouseDown(row("Beta"), { ctrlKey: true })
    expect(screen.getByText(/2 subscriptions · 2 selected/)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText("Search subscriptions…"), { target: { value: "beta" } })
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull())
    expect(isSelected("Beta")).toBe(false)
  })

  it("the Enabled switch sends the same update payload as before and does not select the row", async () => {
    const fetchMock = serve([sub(1, "Alpha"), sub(2, "Beta", { collectionId: null, collectionName: null, enabled: false })])
    renderPage()
    await screen.findByText("Alpha")

    const sw = within(row("Alpha")).getByRole("switch")
    fireEvent.mouseDown(sw)
    fireEvent.mouseUp(window)
    fireEvent.click(sw)
    await waitFor(() => expect(callsTo(fetchMock, "/subscriptions/1").filter(([, i]) => (i as RequestInit).method === "PATCH")).toHaveLength(1))
    const patch = callsTo(fetchMock, "/subscriptions/1").find(([, i]) => (i as RequestInit).method === "PATCH")!
    expect(bodyOf(patch)).toEqual({
      collectionId: 7,
      tags: ["a", "b"],
      autoDownload: false,
      generateNfo: true,
      checkIntervalHours: 6,
      enabled: false,
    })
    expect(isSelected("Alpha")).toBe(false)
    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).not.toBeChecked()

    fireEvent.click(within(row("Beta")).getByRole("switch"))
    await waitFor(() => expect(callsTo(fetchMock, "/subscriptions/2").filter(([, i]) => (i as RequestInit).method === "PATCH")).toHaveLength(1))
    const betaPatch = callsTo(fetchMock, "/subscriptions/2").find(([, i]) => (i as RequestInit).method === "PATCH")!
    expect(bodyOf(betaPatch)).toMatchObject({ enabled: true })
    expect(bodyOf(betaPatch).collectionId).toBeUndefined()
  })

  it("the Enabled switch calls the CURRENT update mutation after a re-render, not a stale one", async () => {
    serve([sub(1, "Alpha"), sub(2, "Beta"), sub(3, "Gamma")])
    const mutates: ReturnType<typeof vi.fn>[] = []
    // A fresh `mutate` identity on every render: a memoized column set that closed over the first one would call it.
    updateHook.override = () => {
      const mutate = vi.fn()
      mutates.push(mutate)
      return { mutate, isPending: false }
    }
    renderPage()
    await screen.findByText("Alpha")
    const rendersBefore = mutates.length

    // Selecting two rows re-renders the page (new `mutate`) without mounting the single-row dialogs, which also
    // call this hook; the columns must pick the new one up.
    select("Beta")
    fireEvent.mouseDown(row("Gamma"), { ctrlKey: true })
    expect(mutates.length).toBeGreaterThan(rendersBefore)
    await waitFor(() => expect(isSelected("Beta")).toBe(true))
    const current = mutates.at(-1)!

    fireEvent.click(within(row("Alpha")).getByRole("switch"))
    expect(current).toHaveBeenCalledTimes(1)
    expect(current).toHaveBeenCalledWith({ id: 1, payload: expect.objectContaining({ enabled: false }) })
    for (const stale of mutates.slice(0, -1)) expect(stale).not.toHaveBeenCalled()
  })

  it("the error badge opens its popover on hover without selecting the row", async () => {
    serve([sub(1, "Alpha", { lastCheckError: "yt-dlp exploded" }), sub(2, "Beta")])
    renderPage()
    await screen.findByText("Alpha")
    const badge = within(row("Alpha")).getByLabelText("Last check failed")

    fireEvent.mouseDown(badge)
    fireEvent.mouseUp(window)
    expect(isSelected("Alpha")).toBe(false)

    fireEvent.mouseEnter(badge)
    const message = await screen.findByText("yt-dlp exploded")
    fireEvent.mouseDown(message)
    fireEvent.mouseUp(window)
    expect(isSelected("Alpha")).toBe(false)
    expect(screen.queryByRole("checkbox", { checked: true })).toBeNull()

    select("Beta")
    expect(isSelected("Beta")).toBe(true)
  })

  it("Check now: one selected row uses the single check, several check each id", async () => {
    const fetchMock = serve([sub(1, "Alpha"), sub(2, "Beta"), sub(3, "Gamma")])
    renderPage()
    await screen.findByText("Alpha")
    expect(toolbarButton("Check now")).toBeDisabled()

    select("Beta")
    fireEvent.click(toolbarButton("Check now"))
    await waitFor(() => expect(callsTo(fetchMock, "/subscriptions/2/check")).toHaveLength(1))
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/check"))).toHaveLength(1)
    await waitFor(() => expect(toolbarButton("Check now")).not.toBeDisabled())

    fireEvent.mouseDown(row("Gamma"), { ctrlKey: true })
    fireEvent.click(toolbarButton("Check now"))
    await waitFor(() => expect(callsTo(fetchMock, "/subscriptions/3/check")).toHaveLength(1))
    expect(callsTo(fetchMock, "/subscriptions/2/check")).toHaveLength(2)
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/check"))).toHaveLength(3)
  })

  it("Edit and Known items are enabled only for exactly one row", async () => {
    serve([sub(1, "Alpha"), sub(2, "Beta")])
    renderPage()
    await screen.findByText("Alpha")
    for (const name of ["Edit", "Known items"]) expect(toolbarButton(name)).toBeDisabled()

    select("Alpha")
    for (const name of ["Edit", "Known items"]) expect(toolbarButton(name)).not.toBeDisabled()

    fireEvent.mouseDown(row("Beta"), { ctrlKey: true })
    for (const name of ["Edit", "Known items"]) expect(toolbarButton(name)).toBeDisabled()
  })

  it("confirms bulk delete with the selection count and deletes each id", async () => {
    const fetchMock = serve([sub(1, "Alpha"), sub(2, "Beta"), sub(3, "Gamma")])
    renderPage()
    await screen.findByText("Alpha")
    const del = toolbarButton("Delete")
    expect(del).toBeDisabled()
    select("Alpha")
    fireEvent.mouseDown(row("Gamma"), { ctrlKey: true })
    fireEvent.click(del)
    expect(await screen.findByText("Delete 2 selected subscriptions?")).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!)
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, i]) => (i as RequestInit)?.method === "DELETE")).toHaveLength(2))
    const deleted = fetchMock.mock.calls.filter(([, i]) => (i as RequestInit)?.method === "DELETE").map(([url]) => url.split("/").at(-1))
    expect(deleted.sort()).toEqual(["1", "3"])
  })

  it("context menu: items and their enabled states follow the selection", async () => {
    serve([sub(1, "Alpha"), sub(2, "Beta")])
    renderPage()
    await screen.findByText("Alpha")

    fireEvent.contextMenu(row("Alpha"))
    const names = (await screen.findAllByRole("menuitem")).map((m) => m.textContent)
    expect(names).toEqual(["Add subscription", "Edit", "Check now", "Known items", "Delete"])
    for (const name of names) expect(screen.getByRole("menuitem", { name: name! })).not.toHaveAttribute("data-disabled")
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    cleanup()

    serve([sub(1, "Alpha"), sub(2, "Beta")])
    renderPage()
    await screen.findByText("Alpha")
    select("Alpha")
    fireEvent.mouseDown(row("Beta"), { ctrlKey: true })
    fireEvent.contextMenu(row("Alpha"))
    expect(await screen.findByRole("menuitem", { name: "Check now (2)" })).not.toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Delete (2)" })).not.toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Known items" })).toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Add subscription" })).not.toHaveAttribute("data-disabled")
  })

  it("paginates at 50 rows per page", async () => {
    serve(Array.from({ length: 120 }, (_, i) => sub(i + 1, `Channel ${String(i + 1).padStart(3, "0")}`)))
    renderPage()
    await screen.findByText("Channel 001")
    expect(screen.getAllByRole("row")).toHaveLength(51)
    expect(screen.getByText("120 subscriptions")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "3" }))
    expect(await screen.findByText("Channel 101")).toBeInTheDocument()
    expect(screen.getAllByRole("row")).toHaveLength(21)
  })
})

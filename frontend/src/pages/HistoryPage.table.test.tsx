import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HistoryPage } from "@/pages/HistoryPage"
import { callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"
import type { HistoryItem } from "@/types/api"

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
  vi.unstubAllGlobals()
})

const CREATED = "2026-10-30T12:34:56Z"

const entry = (id: number, title: string | null, over: Partial<HistoryItem> = {}): HistoryItem => ({
  id,
  downloadId: null,
  url: `https://example.com/${id}`,
  title,
  thumbnail: null,
  status: "completed",
  errorMessage: null,
  createdAt: CREATED,
  ...over,
})

function serve(items: HistoryItem[]) {
  return mockFetch((url, init) => {
    if (/\/history\/\d+\/retry$/.test(url) && init.method === "POST") return { status: 200, body: { id: 1 } }
    if (/\/history\/\d+$/.test(url) && init.method === "DELETE") return { status: 204 }
    if (url.endsWith("/history")) return { status: 200, body: items }
    return { status: 404 }
  })
}

const many = (n: number) => Array.from({ length: n }, (_, i) => entry(i + 1, `Entry ${String(i + 1).padStart(3, "0")}`))

const row = (title: string) => screen.getByText(title).closest("tr")!
const select = (title: string) => {
  fireEvent.mouseDown(row(title))
  fireEvent.mouseUp(window)
}
const isSelected = (title: string) => row(title).getAttribute("data-state") === "selected"
const toolbarButton = (name: string) => screen.getByRole("button", { name })
const renderPage = () => renderWithProviders(<HistoryPage />)
const methodCalls = (fetchMock: ReturnType<typeof mockFetch>, method: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === method).map(([url]) => url as string)

describe("HistoryPage table", () => {
  it("renders the thumbnail, title, status and date columns with the right alignment", async () => {
    serve([
      entry(1, "Alpha", { thumbnail: "https://img.test/a.jpg" }),
      entry(2, null, { status: "failed", errorMessage: "network down", url: "https://example.com/untitled" }),
      entry(3, "Gamma", { status: "duplicate", errorMessage: "already have it" }),
    ])
    renderPage()
    await screen.findByText("Alpha")
    const headers = screen.getAllByRole("columnheader")
    expect(headers.map((h) => h.textContent)).toEqual(["", "", "Title", "Status", "Date"])
    expect(headers[3]).toHaveClass("text-center")
    expect(headers[4]).toHaveClass("text-center")
    expect(headers[2].className).not.toMatch(/text-(right|center)/)
    expect(screen.getByRole("table")).toHaveClass("table-fixed")

    const alpha = within(row("Alpha"))
    expect(alpha.getByText("Completed")).toBeInTheDocument()
    expect(alpha.getByText(new Date(CREATED).toLocaleString())).toHaveClass("text-muted-foreground")
    expect(row("Alpha").querySelector("img")).toHaveAttribute("src", "https://img.test/a.jpg")

    // A missing title falls back to the url; a failed/duplicate entry shows its error line under the title.
    const failed = within(row("https://example.com/untitled"))
    expect(failed.getByText("Failed")).toBeInTheDocument()
    expect(failed.getByText("network down")).toHaveClass("text-destructive")
    expect(within(row("Gamma")).getByText("already have it")).toHaveClass("text-muted-foreground")
    expect(within(row("Gamma")).getByText("Duplicate")).toBeInTheDocument()
    expect(within(row("Alpha")).queryByText(/network|already/)).toBeNull()
    expect(screen.getByText("3 entries")).toBeInTheDocument()
  })

  it("has no resize handle on the thumbnail column; the other columns keep theirs", async () => {
    serve([entry(1, "Alpha")])
    renderPage()
    await screen.findByText("Alpha")
    const [, thumbnail, title, status, date] = screen.getAllByRole("columnheader")
    expect(thumbnail.querySelector("[data-resize-handle]")).toBeNull()
    // Title is the flex column, so it has none either; Status and Date do.
    expect(title.querySelector("[data-resize-handle]")).toBeNull()
    expect(status.querySelector("[data-resize-handle]")).not.toBeNull()
    expect(date.querySelector("[data-resize-handle]")).not.toBeNull()
    expect(screen.getAllByRole("separator")).toHaveLength(2)
  })

  it("searches the title (or url) with a debounce, case-insensitively", async () => {
    serve([entry(1, "Alpha"), entry(2, "Beta"), entry(3, null, { url: "https://videos.test/zeta" })])
    renderPage()
    await screen.findByText("Alpha")
    const box = screen.getByPlaceholderText("Search history…")

    fireEvent.change(box, { target: { value: "ALP" } })
    // Debounced: nothing is filtered right away.
    expect(screen.getByText("Beta")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText("Beta")).toBeNull())
    expect(screen.getByText("1 entry")).toBeInTheDocument()

    fireEvent.change(box, { target: { value: "VIDEOS.test" } })
    await screen.findByText("https://videos.test/zeta")
    expect(screen.queryByText("Alpha")).toBeNull()
  })

  it("shows the empty and no-match messages with a 0 entries footer", async () => {
    serve([])
    renderPage()
    expect(await screen.findByText(/Nothing here yet — completed, failed, and cancelled downloads/)).toBeInTheDocument()
    expect(screen.getByText("0 entries")).toBeInTheDocument()
    cleanup()

    serve([entry(1, "Alpha")])
    renderPage()
    await screen.findByText("Alpha")
    fireEvent.change(screen.getByPlaceholderText("Search history…"), { target: { value: "zzz" } })
    expect(await screen.findByText(/No history entries match "zzz"/)).toBeInTheDocument()
    expect(screen.getByText("0 entries")).toBeInTheDocument()
  })

  it("shows a load failure instead of the table", async () => {
    mockFetch(() => ({ status: 500 }))
    renderPage()
    expect(await screen.findByText(/Failed to load history:/)).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("pages at 50 rows and clears the selection on a page change", async () => {
    serve(many(120))
    renderPage()
    await screen.findByText("Entry 001")
    expect(screen.getAllByRole("row")).toHaveLength(51)
    select("Entry 002")
    expect(screen.getByText("120 entries · 1 selected")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    expect(screen.getByText("Entry 051")).toBeInTheDocument()
    expect(screen.getByText("120 entries")).toBeInTheDocument()
    expect(toolbarButton("Delete")).toBeDisabled()
  })

  it("search resets to page 1 and clears the selection", async () => {
    serve(many(120))
    renderPage()
    await screen.findByText("Entry 001")
    fireEvent.click(screen.getByRole("button", { name: "3" }))
    select("Entry 101")
    expect(toolbarButton("Delete")).toBeEnabled()
    fireEvent.change(screen.getByPlaceholderText("Search history…"), { target: { value: "entry 0" } })
    await waitFor(() => expect(screen.getByText("Entry 001")).toBeInTheDocument())
    expect(screen.getByRole("button", { name: "1" })).toHaveAttribute("aria-current", "page")
    expect(toolbarButton("Delete")).toBeDisabled()
  })

  it("plain click selects one row, ctrl toggles, shift ranges, select-all selects the page", async () => {
    serve([entry(1, "Alpha"), entry(2, "Beta"), entry(3, "Gamma"), entry(4, "Delta")])
    renderPage()
    await screen.findByText("Alpha")
    const states = () => ["Alpha", "Beta", "Gamma", "Delta"].map(isSelected)
    select("Alpha")
    select("Beta")
    expect(states()).toEqual([false, true, false, false])
    fireEvent.mouseDown(row("Delta"), { ctrlKey: true })
    fireEvent.mouseUp(window)
    expect(states()).toEqual([false, true, false, true])
    select("Alpha")
    fireEvent.mouseDown(row("Gamma"), { shiftKey: true })
    fireEvent.mouseUp(window)
    expect(states()).toEqual([true, true, true, false])
    expect(screen.getByText("4 entries · 3 selected")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(states()).toEqual([true, true, true, true])
  })

  it("drag-selects a range of rows", async () => {
    serve([entry(1, "Alpha"), entry(2, "Beta"), entry(3, "Gamma"), entry(4, "Delta")])
    renderPage()
    await screen.findByText("Alpha")
    fireEvent.mouseDown(row("Beta"))
    fireEvent.mouseEnter(row("Delta"))
    fireEvent.mouseUp(window)
    expect(["Alpha", "Beta", "Gamma", "Delta"].map(isSelected)).toEqual([false, true, true, true])
  })

  it("Retry only sends the retryable ids of the selection and is disabled when none is retryable", async () => {
    const fetchMock = serve([
      entry(1, "Done"),
      entry(2, "Broke", { status: "failed" }),
      entry(3, "Stopped", { status: "cancelled" }),
      entry(4, "Cut", { status: "interrupted" }),
      entry(5, "Same", { status: "duplicate" }),
    ])
    renderPage()
    await screen.findByText("Done")
    expect(toolbarButton("Retry")).toBeDisabled()
    expect(toolbarButton("Delete")).toBeDisabled()

    select("Done")
    expect(toolbarButton("Retry")).toBeDisabled()
    expect(toolbarButton("Delete")).toBeEnabled()
    select("Same")
    expect(toolbarButton("Retry")).toBeDisabled()

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(toolbarButton("Retry")).toBeEnabled()
    fireEvent.click(toolbarButton("Retry"))
    await waitFor(() => expect(methodCalls(fetchMock, "POST")).toHaveLength(3))
    expect(
      methodCalls(fetchMock, "POST")
        .map((u) => u.match(/history\/(\d+)\/retry/)![1])
        .sort(),
    ).toEqual(["2", "3", "4"])
    // The selection is cleared once the retries were queued.
    await waitFor(() => expect(toolbarButton("Delete")).toBeDisabled())
  })

  it("Delete confirms with the count, then deletes every selected id and clears the selection", async () => {
    const fetchMock = serve([entry(1, "Alpha"), entry(2, "Beta"), entry(3, "Gamma")])
    renderPage()
    await screen.findByText("Alpha")
    select("Alpha")
    fireEvent.mouseDown(row("Gamma"), { ctrlKey: true })
    fireEvent.mouseUp(window)
    fireEvent.click(toolbarButton("Delete"))
    expect(await screen.findByText("Delete 2 selected entries?")).toBeInTheDocument()
    expect(methodCalls(fetchMock, "DELETE")).toHaveLength(0)

    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(methodCalls(fetchMock, "DELETE")).toHaveLength(2))
    expect(methodCalls(fetchMock, "DELETE").map((u) => u.match(/history\/(\d+)$/)![1]).sort()).toEqual(["1", "3"])
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await waitFor(() => expect(toolbarButton("Delete")).toBeDisabled())
  })

  it("Delete is singular for one row", async () => {
    serve([entry(1, "Alpha"), entry(2, "Beta")])
    renderPage()
    await screen.findByText("Alpha")
    select("Alpha")
    fireEvent.click(toolbarButton("Delete"))
    expect(await screen.findByText("Delete 1 selected entry?")).toBeInTheDocument()
  })

  it("right-click on an unselected row selects it; Retry is disabled for a non-retryable row", async () => {
    serve([entry(1, "Done"), entry(2, "Broke", { status: "failed" })])
    renderPage()
    await screen.findByText("Done")
    fireEvent.contextMenu(row("Done"))
    expect(isSelected("Done")).toBe(true)
    expect(await screen.findByRole("menuitem", { name: "Retry" })).toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Delete" })).not.toHaveAttribute("data-disabled")
  })

  it("right-click on a selected row keeps the selection; only the retryable rows count for Retry", async () => {
    serve([entry(1, "Done"), entry(2, "Broke", { status: "failed" }), entry(3, "Stopped", { status: "cancelled" })])
    renderPage()
    await screen.findByText("Done")
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    fireEvent.contextMenu(row("Broke"))
    expect(await screen.findByRole("menuitem", { name: "Retry (2)" })).not.toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Delete (3)" })).not.toHaveAttribute("data-disabled")
  })

  it("the context-menu Retry and Delete act on the right rows", async () => {
    const fetchMock = serve([entry(1, "Done"), entry(2, "Broke", { status: "failed" })])
    renderPage()
    await screen.findByText("Done")
    fireEvent.contextMenu(row("Broke"))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Retry" }))
    await waitFor(() => expect(callsTo(fetchMock, "/history/2/retry")).toHaveLength(1))
    expect(callsTo(fetchMock, "/history/1/retry")).toHaveLength(0)

    await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull())
    fireEvent.contextMenu(row("Done"))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }))
    expect(await screen.findByText("Delete 1 selected entry?")).toBeInTheDocument()
  })

  it("right-clicking the header opens no menu", async () => {
    serve([entry(1, "Alpha")])
    renderPage()
    await screen.findByText("Alpha")
    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "Title" }))
    expect(screen.queryByRole("menuitem")).toBeNull()
  })
})

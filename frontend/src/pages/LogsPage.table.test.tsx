import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LogsPage } from "@/pages/LogsPage"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import type { DownloadStatus, LogEntry } from "@/types/api"

// Tooltip content only exists while a tooltip is open (and never on a disabled button); render it inline so the
// disabled-reason strings can be asserted.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span data-testid="tip">{children}</span>,
}))

beforeEach(() => {
  // Radix Select needs these in jsdom.
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
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

const log = (id: number, title: string | null, over: Partial<LogEntry> = {}): LogEntry => ({
  id,
  title,
  url: `https://example.com/${id}`,
  status: "completed",
  ytdlpCommand: `yt-dlp https://example.com/${id}`,
  exitCode: 0,
  stdoutTail: "out",
  stderrTail: null,
  retryCount: 0,
  errorMessage: null,
  createdAt: CREATED,
  completedAt: null,
  ...over,
})

const serve = (logs: LogEntry[]) =>
  mockFetch((url) => (url.endsWith("/logs") ? { status: 200, body: logs } : { status: 404 }))

const many = (n: number, over: (i: number) => Partial<LogEntry> = () => ({})) =>
  Array.from({ length: n }, (_, i) => log(i + 1, `Log ${String(i + 1).padStart(3, "0")}`, over(i)))

const row = (title: string) => screen.getByText(title).closest("tr")!
const select = (title: string) => {
  fireEvent.mouseDown(row(title))
  fireEvent.mouseUp(window)
}
const isSelected = (title: string) => row(title).getAttribute("data-state") === "selected"
const viewLog = () => screen.getByRole("button", { name: "View log" })
const tip = () => screen.getByTestId("tip").textContent
const renderPage = () => renderWithProviders(<LogsPage />)

async function chooseStatus(label: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole("combobox"))
  await user.click(await screen.findByRole("option", { name: label }))
}

describe("LogsPage table", () => {
  it("renders the title, status, date and retries columns with the right alignment", async () => {
    serve([log(1, "Alpha", { retryCount: 3, status: "failed" }), log(2, null, { url: "https://example.com/bare" })])
    renderPage()
    await screen.findByText("Alpha")
    const headers = screen.getAllByRole("columnheader")
    expect(headers.map((h) => h.textContent)).toEqual(["", "Title", "Status", "Date", "Retries"])
    expect(headers[2]).toHaveClass("text-center")
    expect(headers[3]).toHaveClass("text-center")
    expect(headers[4]).toHaveClass("text-right")
    expect(headers[1].className).not.toMatch(/text-(right|center)/)

    const alpha = within(row("Alpha"))
    expect(alpha.getByText("Failed")).toBeInTheDocument()
    expect(alpha.getByText("3").closest("td")).toHaveClass("text-right", "text-muted-foreground")
    expect(alpha.getByText(new Date(CREATED).toLocaleString())).toHaveClass("text-muted-foreground")
    expect(alpha.getByText("Alpha")).toHaveClass("max-w-xs", "truncate", "font-medium")
    // No retries shows an em dash; a missing title falls back to the url.
    expect(within(row("https://example.com/bare")).getByText("—")).toBeInTheDocument()
    expect(screen.getByText("2 logs")).toBeInTheDocument()
  })

  it("searches title, url and the yt-dlp command with a debounce", async () => {
    serve([
      log(1, "Alpha"),
      log(2, "Beta", { ytdlpCommand: "yt-dlp --cookies SECRETFLAG https://example.com/2" }),
      log(3, null, { url: "https://example.com/zeta", ytdlpCommand: null }),
    ])
    renderPage()
    await screen.findByText("Alpha")
    const box = screen.getByPlaceholderText("Search title, URL, or command…")

    fireEvent.change(box, { target: { value: "secretflag" } })
    expect(screen.getByText("Alpha")).toBeInTheDocument() // debounced: not filtered yet
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull())
    expect(screen.getByText("Beta")).toBeInTheDocument()
    expect(screen.getByText("1 log")).toBeInTheDocument()

    fireEvent.change(box, { target: { value: "EXAMPLE.com/zeta" } })
    await screen.findByText("https://example.com/zeta")
    expect(screen.queryByText("Beta")).toBeNull()
  })

  it("has a clear button for the search", async () => {
    serve([log(1, "Alpha"), log(2, "Beta")])
    renderPage()
    await screen.findByText("Alpha")
    const box = screen.getByPlaceholderText("Search title, URL, or command…")
    fireEvent.change(box, { target: { value: "alp" } })
    await waitFor(() => expect(screen.queryByText("Beta")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: /clear/i }))
    await screen.findByText("Beta")
    expect(box).toHaveValue("")
  })

  it("shows the empty and no-match messages with a 0 logs footer", async () => {
    serve([])
    renderPage()
    expect(await screen.findByText(/Nothing here yet — logs for each download/)).toBeInTheDocument()
    expect(screen.getByText("0 logs")).toBeInTheDocument()
    cleanup()

    serve([log(1, "Alpha")])
    renderPage()
    await screen.findByText("Alpha")
    fireEvent.change(screen.getByPlaceholderText("Search title, URL, or command…"), { target: { value: "zzz" } })
    expect(await screen.findByText("No logs match your search/filter.")).toBeInTheDocument()
    expect(screen.getByText("0 logs")).toBeInTheDocument()
  })

  it("filters by status, combined with the search", async () => {
    serve([
      log(1, "Alpha done"),
      log(2, "Alpha broke", { status: "failed" }),
      log(3, "Beta broke", { status: "failed" }),
      log(4, "Beta done"),
    ])
    renderPage()
    await screen.findByText("Alpha done")
    await chooseStatus("Failed")
    expect(screen.queryByText("Alpha done")).toBeNull()
    expect(screen.getByText("2 logs")).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText("Search title, URL, or command…"), { target: { value: "beta" } })
    await waitFor(() => expect(screen.queryByText("Alpha broke")).toBeNull())
    expect(screen.getByText("Beta broke")).toBeInTheDocument()
    expect(screen.queryByText("Beta done")).toBeNull()
    expect(screen.getByText("1 log")).toBeInTheDocument()

    await chooseStatus("All statuses")
    await screen.findByText("Beta done")
    expect(screen.getByText("2 logs")).toBeInTheDocument() // the search still applies
    expect(screen.queryByText("Alpha done")).toBeNull()
  })

  it("a status with no rows shows the no-match message", async () => {
    serve([log(1, "Alpha")])
    renderPage()
    await screen.findByText("Alpha")
    await chooseStatus("Cancelled")
    expect(await screen.findByText("No logs match your search/filter.")).toBeInTheDocument()
    expect(screen.getByText("0 logs")).toBeInTheDocument()
  })

  it("changing the status filter goes back to page 1 and clears the selection (resetKey)", async () => {
    // 120 failed + 120 completed, interleaved so every page of either filter has rows.
    serve(many(240, (i) => ({ status: (i % 2 ? "failed" : "completed") as DownloadStatus })))
    renderPage()
    await screen.findByText("Log 001")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    select("Log 101")
    expect(screen.getByText("240 logs · 1 selected")).toBeInTheDocument()
    expect(viewLog()).toBeEnabled()

    await chooseStatus("Failed")
    expect(screen.getByText("120 logs")).toBeInTheDocument() // no "· 1 selected"
    expect(screen.getByRole("button", { name: "1" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByText("Log 002")).toBeInTheDocument() // first failed row, i.e. page 1
    expect(viewLog()).toBeDisabled()
    expect(tip()).toBe("Select a log to view")
  })

  it("search resets to page 1 and clears the selection", async () => {
    serve(many(120))
    renderPage()
    await screen.findByText("Log 001")
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    select("Log 101")
    fireEvent.change(screen.getByPlaceholderText("Search title, URL, or command…"), { target: { value: "log 0" } })
    await waitFor(() => expect(screen.getByText("Log 001")).toBeInTheDocument())
    expect(screen.getByRole("button", { name: "1" })).toHaveAttribute("aria-current", "page")
    expect(viewLog()).toBeDisabled()
  })

  it("selects with click, ctrl, shift and select-all; the footer counts them", async () => {
    serve([log(1, "Alpha"), log(2, "Beta"), log(3, "Gamma"), log(4, "Delta")])
    renderPage()
    await screen.findByText("Alpha")
    const states = () => ["Alpha", "Beta", "Gamma", "Delta"].map(isSelected)
    select("Beta")
    expect(states()).toEqual([false, true, false, false])
    fireEvent.mouseDown(row("Delta"), { ctrlKey: true })
    fireEvent.mouseUp(window)
    expect(states()).toEqual([false, true, false, true])
    expect(screen.getByText("4 logs · 2 selected")).toBeInTheDocument()
    select("Alpha")
    fireEvent.mouseDown(row("Gamma"), { shiftKey: true })
    fireEvent.mouseUp(window)
    expect(states()).toEqual([true, true, true, false])
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(states()).toEqual([true, true, true, true])
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(states()).toEqual([false, false, false, false])
  })

  it("View log: reason strings for none, several and a log-less selection", async () => {
    serve([log(1, "Alpha"), log(2, "Beta"), log(3, "Empty", { ytdlpCommand: null, stdoutTail: null, stderrTail: null })])
    renderPage()
    await screen.findByText("Alpha")
    expect(viewLog()).toBeDisabled()
    expect(tip()).toBe("Select a log to view")

    select("Alpha")
    expect(viewLog()).toBeEnabled()
    expect(tip()).toBe("View log")

    fireEvent.mouseDown(row("Beta"), { ctrlKey: true })
    fireEvent.mouseUp(window)
    expect(viewLog()).toBeDisabled()
    expect(tip()).toBe("Select a single log to view")

    select("Empty")
    expect(viewLog()).toBeDisabled()
    expect(tip()).toBe("No log captured yet")
  })

  it("View log opens the dialog for the selected entry", async () => {
    serve([log(1, "Alpha", { exitCode: 7, stdoutTail: "hello stdout" }), log(2, "Beta")])
    renderPage()
    await screen.findByText("Alpha")
    select("Alpha")
    fireEvent.click(viewLog())
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Alpha")).toBeInTheDocument()
    expect(within(dialog).getByText("Exit code: 7")).toBeInTheDocument()
    expect(within(dialog).getByText("hello stdout")).toBeInTheDocument()
  })

  it("the context menu has View log, enabled only for one row with a captured log", async () => {
    serve([log(1, "Alpha", { stdoutTail: "hello stdout" }), log(2, "Empty", { ytdlpCommand: null, stdoutTail: null })])
    renderPage()
    await screen.findByText("Alpha")

    fireEvent.contextMenu(row("Alpha"))
    expect(isSelected("Alpha")).toBe(true)
    const item = await screen.findByRole("menuitem", { name: "View log" })
    expect(item).not.toHaveAttribute("data-disabled")
    fireEvent.click(item)
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    fireEvent.contextMenu(row("Empty"))
    expect(await screen.findByRole("menuitem", { name: "View log" })).toHaveAttribute("data-disabled")
  })

  it("right-clicking a row of a multi-selection keeps it and disables View log", async () => {
    serve([log(1, "Alpha"), log(2, "Beta")])
    renderPage()
    await screen.findByText("Alpha")
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    fireEvent.contextMenu(row("Beta"))
    expect(await screen.findByRole("menuitem", { name: "View log" })).toHaveAttribute("data-disabled")
    expect(isSelected("Alpha")).toBe(true)
  })

  it("right-clicking the header opens no menu", async () => {
    serve([log(1, "Alpha")])
    renderPage()
    await screen.findByText("Alpha")
    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "Title" }))
    expect(screen.queryByRole("menuitem")).toBeNull()
  })

  it("shows a load failure instead of the table", async () => {
    mockFetch(() => ({ status: 500 }))
    renderPage()
    expect(await screen.findByText(/Failed to load logs:/)).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })
})

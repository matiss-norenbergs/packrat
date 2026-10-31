import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FrameMatchingPage } from "@/pages/FrameMatchingPage"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import type { FrameMatchQueueItem } from "@/types/api"

vi.mock("@/components/library/FrameMatchResult", () => ({
  FrameMatchResult: ({ itemTitle }: { itemTitle: string }) => <div>match-result-{itemTitle}</div>,
}))

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

const item = (id: number, title: string, over: Partial<FrameMatchQueueItem> = {}): FrameMatchQueueItem => ({
  id,
  libraryItemId: 100 + id,
  itemTitle: title,
  mode: "url",
  state: "done",
  score: 87.4,
  ...over,
})

// The queue is server state that shrinks as items are discarded; the responder reads `queue` on every call.
function serve(initial: FrameMatchQueueItem[]) {
  let queue = initial
  const fetchMock = mockFetch((url, init) => {
    const del = url.match(/\/frame-match\/queue\/(\d+)$/)
    if (del && init.method === "DELETE") {
      queue = queue.filter((i) => i.id !== Number(del[1]))
      return { status: 204 }
    }
    if (url.endsWith("/frame-match/queue")) return { status: 200, body: queue }
    return { status: 404 }
  })
  return fetchMock
}

const many = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1, `Item ${String(i + 1).padStart(3, "0")}`))

const row = (title: string) => screen.getByText(title).closest("tr")!
const select = (title: string) => {
  fireEvent.mouseDown(row(title))
  fireEvent.mouseUp(window)
}
const isSelected = (title: string) => row(title).getAttribute("data-state") === "selected"
const toolbarButton = (name: string) => screen.getByRole("button", { name })
const renderPage = () => renderWithProviders(<FrameMatchingPage />)
const deletes = (fetchMock: ReturnType<typeof mockFetch>) =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")
    .map(([url]) => Number((url as string).match(/queue\/(\d+)$/)![1]))
    .sort((a, b) => a - b)

describe("FrameMatchingPage table", () => {
  it("renders the item link, mode and a centred state column for every state", async () => {
    serve([
      item(1, "Alpha", { mode: "url", state: "done", score: 87.4 }),
      item(2, "Beta", { mode: "current", state: "running", score: undefined }),
      item(3, "Gamma", { state: "queued", score: undefined }),
      item(4, "Delta", { state: "error", score: undefined, error: "ffmpeg exploded" }),
    ])
    renderPage()
    await screen.findByText("Alpha")
    const headers = screen.getAllByRole("columnheader")
    expect(headers.map((h) => h.textContent)).toEqual(["", "Item", "Mode", "State"])
    expect(headers[2]).toHaveClass("text-center")
    expect(headers[3]).toHaveClass("text-center") // the one deliberate change: State used to be left-aligned
    expect(headers[1].className).not.toMatch(/text-(right|center)/)
    expect(row("Alpha").children[3]).toHaveClass("text-center")

    const alpha = within(row("Alpha"))
    expect(alpha.getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "/library/101")
    expect(alpha.getByRole("link", { name: "Alpha" })).toHaveClass("underline", "underline-offset-2")
    expect(alpha.getByText("From URL")).toBeInTheDocument()
    expect(alpha.getByText("done")).toHaveClass("capitalize")
    expect(alpha.getByText("87% confidence")).toBeInTheDocument()

    expect(within(row("Beta")).getByText("From current")).toBeInTheDocument()
    expect(row("Beta").querySelector("svg.animate-spin")).not.toBeNull()
    expect(within(row("Beta")).queryByText(/confidence/)).toBeNull()
    expect(within(row("Gamma")).getByText("queued")).toBeInTheDocument()
    expect(within(row("Delta")).getByLabelText("Match failed")).toBeInTheDocument()
    expect(screen.getByText("4 items")).toBeInTheDocument()
  })

  it("shows the empty message with a 0 items footer and no search box", async () => {
    serve([])
    renderPage()
    expect(await screen.findByText("Nothing queued right now.")).toBeInTheDocument()
    expect(screen.getByText("0 items")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull()
    expect(toolbarButton("Review")).toBeDisabled()
    expect(toolbarButton("Discard")).toBeDisabled()
  })

  it("selects with click, ctrl, shift and select-all; the footer counts the selection", async () => {
    serve([item(1, "Alpha"), item(2, "Beta"), item(3, "Gamma"), item(4, "Delta")])
    renderPage()
    await screen.findByText("Alpha")
    const states = () => ["Alpha", "Beta", "Gamma", "Delta"].map(isSelected)
    select("Beta")
    expect(states()).toEqual([false, true, false, false])
    fireEvent.mouseDown(row("Delta"), { ctrlKey: true })
    fireEvent.mouseUp(window)
    expect(states()).toEqual([false, true, false, true])
    expect(screen.getByText("4 items · 2 selected")).toBeInTheDocument()
    select("Alpha")
    fireEvent.mouseDown(row("Gamma"), { shiftKey: true })
    fireEvent.mouseUp(window)
    expect(states()).toEqual([true, true, true, false])
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(states()).toEqual([true, true, true, true])
  })

  it("drag-selects a range of rows", async () => {
    serve([item(1, "Alpha"), item(2, "Beta"), item(3, "Gamma")])
    renderPage()
    await screen.findByText("Alpha")
    fireEvent.mouseDown(row("Alpha"))
    fireEvent.mouseEnter(row("Gamma"))
    fireEvent.mouseUp(window)
    expect(["Alpha", "Beta", "Gamma"].map(isSelected)).toEqual([true, true, true])
  })

  it("the item link and the error badge do not select the row", async () => {
    serve([item(1, "Alpha"), item(2, "Beta", { state: "error", error: "ffmpeg exploded", score: undefined })])
    renderPage()
    await screen.findByText("Alpha")
    const link = within(row("Alpha")).getByRole("link", { name: "Alpha" })
    fireEvent.mouseDown(link)
    fireEvent.mouseUp(window)
    expect(isSelected("Alpha")).toBe(false)

    const badge = within(row("Beta")).getByLabelText("Match failed")
    fireEvent.mouseDown(badge)
    fireEvent.mouseUp(window)
    expect(isSelected("Beta")).toBe(false)
    fireEvent.mouseEnter(badge)
    const message = await screen.findByText("ffmpeg exploded")
    fireEvent.mouseDown(message)
    fireEvent.mouseUp(window)
    expect(isSelected("Beta")).toBe(false)
    expect(screen.queryByRole("checkbox", { checked: true })).toBeNull()
  })

  it("Review is enabled only for a single selected done item", async () => {
    serve([item(1, "Alpha"), item(2, "Beta", { state: "running", score: undefined }), item(3, "Gamma")])
    renderPage()
    await screen.findByText("Alpha")
    expect(toolbarButton("Review")).toBeDisabled()
    select("Alpha")
    expect(toolbarButton("Review")).toBeEnabled()
    select("Beta")
    expect(toolbarButton("Review")).toBeDisabled()
    expect(toolbarButton("Discard")).toBeEnabled()
    select("Alpha")
    fireEvent.mouseDown(row("Gamma"), { ctrlKey: true })
    fireEvent.mouseUp(window)
    expect(toolbarButton("Review")).toBeDisabled()

    select("Gamma")
    fireEvent.click(toolbarButton("Review"))
    expect(await screen.findByText("match-result-Gamma")).toBeInTheDocument()
  })

  it("the context menu has Review (one done item only) and Discard", async () => {
    serve([item(1, "Alpha"), item(2, "Beta", { state: "queued", score: undefined })])
    renderPage()
    await screen.findByText("Alpha")

    fireEvent.contextMenu(row("Alpha"))
    expect(isSelected("Alpha")).toBe(true)
    expect(await screen.findByRole("menuitem", { name: "Review" })).not.toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Discard" })).not.toHaveAttribute("data-disabled")
    fireEvent.click(screen.getByRole("menuitem", { name: "Review" }))
    expect(await screen.findByText("match-result-Alpha")).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    fireEvent.contextMenu(row("Beta"))
    expect(await screen.findByRole("menuitem", { name: "Review" })).toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Discard" })).not.toHaveAttribute("data-disabled")
  })

  it("right-clicking the header opens no menu", async () => {
    serve([item(1, "Alpha")])
    renderPage()
    await screen.findByText("Alpha")
    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "Item" }))
    expect(screen.queryByRole("menuitem")).toBeNull()
  })

  it("Discard confirms with the count and discards every selected id", async () => {
    const fetchMock = serve([item(1, "Alpha"), item(2, "Beta"), item(3, "Gamma")])
    renderPage()
    await screen.findByText("Alpha")
    select("Alpha")
    fireEvent.mouseDown(row("Gamma"), { ctrlKey: true })
    fireEvent.mouseUp(window)
    fireEvent.click(toolbarButton("Discard"))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Discard 2 items?")).toBeInTheDocument()
    expect(deletes(fetchMock)).toEqual([])

    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }))
    await waitFor(() => expect(deletes(fetchMock)).toEqual([1, 3]))
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull())
    expect(screen.getByText("Beta")).toBeInTheDocument()
    expect(screen.getByText("1 item")).toBeInTheDocument()
    expect(toolbarButton("Discard")).toBeDisabled()
  })

  it("Discard is singular for one item", async () => {
    serve([item(1, "Alpha"), item(2, "Beta")])
    renderPage()
    await screen.findByText("Alpha")
    select("Beta")
    fireEvent.click(toolbarButton("Discard"))
    expect(await screen.findByText("Discard 1 item?")).toBeInTheDocument()
  })

  it("drops selected ids that left the live queue", async () => {
    const fetchMock = serve([item(1, "Alpha"), item(2, "Beta")])
    renderPage()
    await screen.findByText("Alpha")
    select("Alpha")
    expect(screen.getByText("2 items · 1 selected")).toBeInTheDocument()

    // Discarding from the Review dialog leaves the table's selection alone; the row then leaves the queue.
    fireEvent.click(toolbarButton("Review"))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }))
    await waitFor(() => expect(deletes(fetchMock)).toEqual([1]))
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull())
    await waitFor(() => expect(screen.getByText("1 item")).toBeInTheDocument()) // no stale "· 1 selected"
    expect(toolbarButton("Discard")).toBeDisabled()
  })

  it("keeps a selected id that is still in the queue when others leave it", async () => {
    const fetchMock = serve([item(1, "Alpha"), item(2, "Beta"), item(3, "Gamma", { state: "running", score: undefined })])
    renderPage()
    await screen.findByText("Alpha")
    select("Alpha")
    fireEvent.click(toolbarButton("Review"))
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard" }))
    await waitFor(() => expect(deletes(fetchMock)).toEqual([1]))
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull())
    select("Gamma")
    expect(isSelected("Gamma")).toBe(true)
    expect(screen.getByText("2 items · 1 selected")).toBeInTheDocument()
  })

  it("pages at 25 and snaps back when the queue shrinks under the current page", async () => {
    const fetchMock = serve(many(26))
    renderPage()
    await screen.findByText("Item 001")
    expect(screen.getAllByRole("row")).toHaveLength(26)
    expect(screen.getByText("26 items")).toBeInTheDocument()
    select("Item 002")
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    expect(screen.getByText("26 items")).toBeInTheDocument() // selection cleared by the page change
    expect(screen.getByText("Item 026")).toBeInTheDocument()
    expect(screen.queryByText("Item 001")).toBeNull()

    select("Item 026")
    fireEvent.click(toolbarButton("Review"))
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard" }))
    await waitFor(() => expect(deletes(fetchMock)).toEqual([26]))
    expect(await screen.findByText("Item 001")).toBeInTheDocument()
    expect(screen.getByText("25 items")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "1" })).toHaveAttribute("aria-current", "page")
  })
})

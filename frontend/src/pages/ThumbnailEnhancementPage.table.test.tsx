import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FloatingActionDock } from "@/components/FloatingActionDock"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { formatBytes, hashText } from "@/lib/utils"
import { ThumbnailEnhancementPage } from "@/pages/ThumbnailEnhancementPage"
import { mockFetch } from "@/test/mockApi"
import type { ThumbnailEnhancementHistoryEntry } from "@/types/api"

beforeEach(() => {
  // Radix Select (the filters) needs these in jsdom.
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
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

const PAGE_SIZE = 25

function entry(id: number, title: string, over: Partial<ThumbnailEnhancementHistoryEntry> = {}): ThumbnailEnhancementHistoryEntry {
  return {
    id,
    libraryItemId: 100 + id,
    itemTitle: title,
    status: "success",
    originalWidth: 640,
    originalHeight: 360,
    enhancedWidth: 1280,
    enhancedHeight: 720,
    originalSizeBytes: 50_000,
    enhancedSizeBytes: 800_000,
    error: null,
    createdAt: `2026-10-${String(10 + (id % 18)).padStart(2, "0")}T10:00:00Z`,
    hasOriginalBackup: false,
    originalThumbnailPath: null,
    enhancedThumbnailPath: null,
    revertedAt: null,
    triggerType: "manual",
    mode: "upscale",
    blurred: false,
    ...over,
  }
}

type Query = Record<string, string>

// Behaves like the server: filters by q/status/trigger/mode and slices 25 per page.
function serve(all: ThumbnailEnhancementHistoryEntry[], opts: { privacy?: boolean } = {}) {
  return mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: opts.privacy ?? false, thumbnailEnhancementEnabled: true } }
    if (url.endsWith("/collections")) return { status: 200, body: opts.privacy ? [{ id: 1, effectiveIsPrivate: true, totalItemCount: 3 }] : [] }
    if (url.endsWith("/tags") || url.endsWith("/artists")) return { status: 200, body: [] }
    if (url.includes("/thumbnail-enhancement/history")) {
      const p = new URL(url, "http://x").searchParams
      const q = (p.get("q") ?? "").toLowerCase()
      const rows = all.filter(
        (e) =>
          (!q || e.itemTitle.toLowerCase().includes(q)) &&
          (!p.get("status") || e.status === p.get("status")) &&
          (!p.get("trigger") || e.triggerType === p.get("trigger")) &&
          (!p.get("mode") || e.mode === p.get("mode")),
      )
      const page = Number(p.get("page") ?? "1")
      return { status: 200, body: { entries: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: rows.length } }
    }
    if (url.includes("/thumbnail-enhancement/status")) return { status: 200, body: { configured: false, reachable: false } }
    return { status: 404 }
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <RevealAllProvider>
            <FloatingActionDock>
              <ThumbnailEnhancementPage />
            </FloatingActionDock>
          </RevealAllProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const historyQueries = (fn: ReturnType<typeof mockFetch>): Query[] =>
  fn.mock.calls
    .filter(([url]) => url.includes("/thumbnail-enhancement/history"))
    .map(([url]) => Object.fromEntries(new URL(url, "http://x").searchParams))
const lastQuery = (fn: ReturnType<typeof mockFetch>) => historyQueries(fn).at(-1)

const row = (title: string) => screen.getByText(title).closest("tr")!
const select = (title: string) => {
  fireEvent.mouseDown(row(title))
  fireEvent.mouseUp(window)
}
const isSelected = (title: string) => row(title).getAttribute("data-state") === "selected"
const checkedBoxes = () => screen.queryAllByRole("checkbox", { checked: true })
const searchBox = () => screen.getByPlaceholderText("Search by item title…")
const toolbarButton = (name: string) => screen.getByRole("button", { name })
const compareButton = (title: string) => row(title).querySelector<HTMLButtonElement>("td:last-child button")

const many = (n: number, over: (i: number) => Partial<ThumbnailEnhancementHistoryEntry> = () => ({})) =>
  Array.from({ length: n }, (_, k) => entry(n - k, `Item ${String(n - k).padStart(3, "0")}`, over(n - k)))

async function pickFilter(index: number, option: string) {
  const user = userEvent.setup()
  await user.click(screen.getAllByRole("combobox")[index])
  await user.click(await screen.findByRole("option", { name: option }))
}

describe("ThumbnailEnhancementPage table", () => {
  it("renders every column: item link vs plain/hashed title, status badges, trigger, type, dimensions, size, date, Compare", async () => {
    serve(
      [
        entry(1, "Alpha", { hasOriginalBackup: true, triggerType: "manual", mode: "upscale" }),
        entry(2, "Beta", {
          libraryItemId: null,
          status: "failed",
          error: "boom",
          triggerType: "scheduled",
          mode: "sharpen",
          originalWidth: null,
          originalHeight: null,
          enhancedWidth: null,
          enhancedHeight: null,
          originalSizeBytes: null,
          enhancedSizeBytes: null,
        }),
        entry(3, "Gamma", { revertedAt: "2026-10-20T10:00:00Z", triggerType: "auto" }),
        entry(4, "Secret", { blurred: true }),
      ],
      { privacy: true },
    )
    renderPage()
    await screen.findByText("Alpha")
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "",
      "Item",
      "Status",
      "Trigger",
      "Type",
      "Dimensions",
      "Size",
      "Date",
      "Actions",
    ])

    const alpha = within(row("Alpha"))
    expect(alpha.getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "/library/101")
    expect(alpha.getByText("Success")).toBeInTheDocument()
    expect(alpha.getByText("Manual")).toBeInTheDocument()
    expect(alpha.getByText("Upscale")).toBeInTheDocument()
    expect(alpha.getByText("640×360 → 1280×720")).toBeInTheDocument()
    expect(alpha.getByText(`${formatBytes(50_000)} → ${formatBytes(800_000)}`)).toBeInTheDocument()
    expect(alpha.getByText(new Date("2026-10-11T10:00:00Z").toLocaleString())).toBeInTheDocument()
    expect(compareButton("Alpha")).not.toBeNull()

    const beta = within(row("Beta"))
    expect(screen.getByText("Beta").closest("a")).toBeNull()
    expect(beta.getByText("Failed")).toBeInTheDocument()
    expect(beta.getByLabelText("Enhancement failed")).toBeInTheDocument()
    expect(beta.getByText("Scheduled")).toBeInTheDocument()
    expect(beta.getByText("Sharpen")).toBeInTheDocument()
    expect(beta.getAllByText("— → —")).toHaveLength(2)
    expect(compareButton("Beta")).toBeNull()

    const gamma = within(row("Gamma"))
    expect(gamma.getByText("Reverted")).toBeInTheDocument()
    expect(gamma.queryByText("Success")).toBeNull()
    expect(gamma.queryByLabelText("Enhancement failed")).toBeNull()
    expect(gamma.getByText("Auto")).toBeInTheDocument()

    expect(screen.queryByText("Secret")).toBeNull()
    const hidden = screen.getByText(hashText("Secret"))
    expect(hidden.closest("a")).toBeNull()
    expect(screen.getByText("4 entries")).toBeInTheDocument()
  })

  it("keeps the numeric, date, status and icon columns aligned like before", async () => {
    serve([entry(1, "Alpha")])
    renderPage()
    await screen.findByText("Alpha")
    const headers = screen.getAllByRole("columnheader")
    const cls = (i: number) => headers[i].className
    for (const i of [2, 3, 4, 7, 8]) expect(cls(i)).toContain("text-center")
    for (const i of [5, 6]) expect(cls(i)).toContain("text-right")
    expect(cls(1)).not.toMatch(/text-(right|center)/)
    const cells = row("Alpha").querySelectorAll("td")
    expect(cells[6].className).toContain("text-right")
    expect(cells[8].firstElementChild).toHaveClass("flex", "justify-center")
  })

  it("sends the search (after the debounce) and every filter and page to the history hook, resetting to page 1", async () => {
    const fetchMock = serve(many(60, (i) => ({ status: i % 2 ? "success" : "failed", mode: i % 3 ? "upscale" : "sharpen" })))
    renderPage()
    await screen.findByText("Item 060")
    expect(lastQuery(fetchMock)).toEqual({ page: "1" })
    expect(screen.getByText("60 entries")).toBeInTheDocument()
    expect(screen.getAllByRole("row")).toHaveLength(PAGE_SIZE + 1)

    fireEvent.click(screen.getByRole("button", { name: "2" }))
    await screen.findByText("Item 035")
    expect(lastQuery(fetchMock)).toEqual({ page: "2" })

    // The search is debounced: nothing is sent while typing, then q and page=1.
    const before = historyQueries(fetchMock).length
    fireEvent.change(searchBox(), { target: { value: "item 05" } })
    expect(historyQueries(fetchMock)).toHaveLength(before)
    await waitFor(() => expect(lastQuery(fetchMock)).toEqual({ q: "item 05", page: "1" }))
    expect(await screen.findByText("10 entries")).toBeInTheDocument()

    await pickFilter(0, "Failed")
    await waitFor(() => expect(lastQuery(fetchMock)).toEqual({ q: "item 05", status: "failed", page: "1" }))
    await pickFilter(1, "Manual")
    await waitFor(() => expect(lastQuery(fetchMock)).toEqual({ q: "item 05", status: "failed", trigger: "manual", page: "1" }))
    await pickFilter(2, "Sharpen")
    await waitFor(() =>
      expect(lastQuery(fetchMock)).toEqual({ q: "item 05", status: "failed", trigger: "manual", mode: "sharpen", page: "1" }),
    )
    await pickFilter(0, "All statuses")
    await waitFor(() => expect(lastQuery(fetchMock)).toEqual({ q: "item 05", trigger: "manual", mode: "sharpen", page: "1" }))
  })

  it("resets to page 1 when a filter or the search changes while on a later page", async () => {
    const fetchMock = serve(many(60))
    renderPage()
    await screen.findByText("Item 060")

    fireEvent.click(screen.getByRole("button", { name: "3" }))
    await screen.findByText("Item 010")
    expect(lastQuery(fetchMock)).toEqual({ page: "3" })
    await pickFilter(1, "Manual")
    await waitFor(() => expect(lastQuery(fetchMock)).toEqual({ trigger: "manual", page: "1" }))

    fireEvent.click(await screen.findByRole("button", { name: "2" }))
    await waitFor(() => expect(lastQuery(fetchMock)).toEqual({ trigger: "manual", page: "2" }))
    fireEvent.change(searchBox(), { target: { value: "item" } })
    await waitFor(() => expect(lastQuery(fetchMock)).toEqual({ q: "item", trigger: "manual", page: "1" }))
  })

  it("clears the selection when the page, a filter or the search changes", async () => {
    serve(many(60, (i) => ({ triggerType: i % 2 ? "manual" : "auto" })))
    renderPage()
    await screen.findByText("Item 060")

    select("Item 060")
    expect(checkedBoxes()).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    await screen.findByText("Item 035")
    expect(checkedBoxes()).toHaveLength(0)
    expect(screen.queryByText(/selected/)).toBeNull()

    select("Item 035")
    expect(checkedBoxes()).toHaveLength(1)
    await pickFilter(1, "Manual")
    await screen.findByText("30 entries")
    expect(checkedBoxes()).toHaveLength(0)

    select("Item 059")
    expect(checkedBoxes()).toHaveLength(1)
    fireEvent.change(searchBox(), { target: { value: "item 05" } })
    await screen.findByText("5 entries")
    expect(checkedBoxes()).toHaveLength(0)
  })

  it("shows the empty and the no-match messages, with a 0 entries footer", async () => {
    serve([])
    renderPage()
    expect(await screen.findByText("Nothing enhanced yet.")).toBeInTheDocument()
    expect(screen.getByText("0 entries")).toBeInTheDocument()
    cleanup()

    serve([entry(1, "Alpha")])
    renderPage()
    await screen.findByText("Alpha")
    fireEvent.change(searchBox(), { target: { value: "zzz" } })
    expect(await screen.findByText("No history entries match these filters.")).toBeInTheDocument()
    expect(screen.queryByText("Nothing enhanced yet.")).toBeNull()
    expect(screen.getByText("0 entries")).toBeInTheDocument()
    cleanup()

    serve([entry(1, "Alpha")])
    renderPage()
    await screen.findByText("Alpha")
    await pickFilter(0, "Failed")
    expect(await screen.findByText("No history entries match these filters.")).toBeInTheDocument()
  })

  it("footer: singular/plural total and the selected count", async () => {
    serve([entry(1, "Alpha")])
    renderPage()
    await screen.findByText("Alpha")
    expect(screen.getByText("1 entry")).toBeInTheDocument()
    select("Alpha")
    expect(screen.getByText("1 entry · 1 selected")).toBeInTheDocument()
    cleanup()

    serve(many(60))
    renderPage()
    await screen.findByText("Item 060")
    select("Item 060")
    fireEvent.mouseDown(row("Item 058"), { ctrlKey: true })
    expect(screen.getByText("60 entries · 2 selected")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(screen.getByText(`60 entries · ${PAGE_SIZE} selected`)).toBeInTheDocument()
  })

  it("the title link, the error badge, its popover and the Compare button do not select the row; a plain cell does", async () => {
    serve([
      entry(1, "Alpha", { hasOriginalBackup: true }),
      entry(2, "Beta", { libraryItemId: null, status: "failed", error: "upstream exploded" }),
      entry(3, "Gamma"),
    ])
    renderPage()
    await screen.findByText("Alpha")
    const press = (el: Element) => {
      fireEvent.mouseDown(el)
      fireEvent.mouseUp(window)
    }

    press(screen.getByRole("link", { name: "Alpha" }))
    expect(isSelected("Alpha")).toBe(false)
    press(compareButton("Alpha")!)
    expect(isSelected("Alpha")).toBe(false)

    const badge = within(row("Beta")).getByLabelText("Enhancement failed")
    press(badge)
    expect(isSelected("Beta")).toBe(false)
    fireEvent.mouseEnter(badge)
    const message = await screen.findByText("upstream exploded")
    press(message)
    expect(isSelected("Beta")).toBe(false)
    expect(checkedBoxes()).toHaveLength(0)

    press(within(row("Gamma")).getByText("Success"))
    expect(isSelected("Gamma")).toBe(true)
    expect(checkedBoxes()).toHaveLength(1)
  })

  it("Compare opens the dialog for that entry", async () => {
    serve([entry(1, "Alpha"), entry(2, "Beta", { hasOriginalBackup: true }), entry(3, "Gamma", { hasOriginalBackup: true })])
    renderPage()
    await screen.findByText("Alpha")
    fireEvent.click(compareButton("Gamma")!)
    expect(await screen.findByText("Compare — Gamma")).toBeInTheDocument()
    expect(screen.queryByText("Compare — Beta")).toBeNull()
  })

  it("Delete and the More actions menu: disabled states and counts, deduping library items across rows", async () => {
    const user = userEvent.setup()
    serve([
      entry(1, "A1", { libraryItemId: 20, hasOriginalBackup: true }),
      entry(2, "A2", { libraryItemId: 20, hasOriginalBackup: true }),
      entry(3, "B", { libraryItemId: 21, hasOriginalBackup: true }),
      entry(4, "C", { libraryItemId: 22, hasOriginalBackup: false }),
      entry(5, "D", { libraryItemId: null, hasOriginalBackup: true }),
    ])
    renderPage()
    await screen.findByText("A1")
    expect(toolbarButton("Delete")).toBeDisabled()
    expect(toolbarButton("More actions")).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull()

    // One row with a backup: no counts in the labels.
    select("A1")
    expect(toolbarButton("Delete")).not.toBeDisabled()
    await user.click(toolbarButton("More actions"))
    expect(await screen.findByRole("menuitem", { name: "Keep enhanced" })).not.toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Keep original" })).not.toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Redownload original" })).not.toHaveAttribute("data-disabled")
    await user.keyboard("{Escape}")

    // Select everything: A1+A2 share item 20, so keep = {20,21} = 2, redownload = {20,21,22} = 3 (D has no item).
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    await user.click(toolbarButton("More actions"))
    expect(await screen.findByRole("menuitem", { name: "Keep enhanced (2)" })).not.toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Keep original (2)" })).not.toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Redownload original (3)" })).not.toHaveAttribute("data-disabled")
    await user.click(screen.getByRole("menuitem", { name: "Keep enhanced (2)" }))
    expect(await screen.findByText("Keep enhanced thumbnail for 2 items?")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

    // Only a row without a backup: keep actions are disabled, redownload is not.
    await user.click(screen.getByRole("button", { name: "Clear" }))
    select("C")
    await user.click(toolbarButton("More actions"))
    expect(await screen.findByRole("menuitem", { name: "Keep enhanced" })).toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Keep original" })).toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Redownload original" })).not.toHaveAttribute("data-disabled")
    await user.keyboard("{Escape}")

    // A row with a backup but no library item: nothing to keep, nothing to redownload.
    await user.click(screen.getByRole("button", { name: "Clear" }))
    select("D")
    await user.click(toolbarButton("More actions"))
    expect(await screen.findByRole("menuitem", { name: "Keep enhanced" })).toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Redownload original" })).toHaveAttribute("data-disabled")
  })

  it("Delete confirms with the selection count and the backup warning only when a selected row has a stored original", async () => {
    serve([entry(1, "Alpha", { hasOriginalBackup: true }), entry(2, "Beta"), entry(3, "Gamma")])
    renderPage()
    await screen.findByText("Alpha")

    select("Beta")
    fireEvent.click(toolbarButton("Delete"))
    expect(await screen.findByText("Delete 1 history entry?")).toBeInTheDocument()
    expect(screen.getByText("Removes the selected rows from the list. This can't be undone.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

    fireEvent.mouseDown(row("Alpha"), { ctrlKey: true })
    fireEvent.click(toolbarButton("Delete"))
    expect(await screen.findByText("Delete 2 history entries?")).toBeInTheDocument()
    expect(screen.getByText(/still have a stored original/)).toBeInTheDocument()
  })

  it("context menu: a single Delete item that follows the selection", async () => {
    serve([entry(1, "Alpha"), entry(2, "Beta"), entry(3, "Gamma")])
    renderPage()
    await screen.findByText("Alpha")

    // Right-clicking an unselected row selects just that row.
    fireEvent.contextMenu(row("Alpha"))
    const items = await screen.findAllByRole("menuitem")
    expect(items.map((i) => i.textContent)).toEqual(["Delete"])
    expect(items[0]).not.toHaveAttribute("data-disabled")
    expect(isSelected("Alpha")).toBe(true)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    cleanup()

    serve([entry(1, "Alpha"), entry(2, "Beta"), entry(3, "Gamma")])
    renderPage()
    await screen.findByText("Alpha")
    select("Alpha")
    fireEvent.mouseDown(row("Beta"), { ctrlKey: true })
    fireEvent.contextMenu(row("Beta"))
    const del = await screen.findByRole("menuitem", { name: "Delete (2)" })
    expect(del).not.toHaveAttribute("data-disabled")
    expect(isSelected("Alpha")).toBe(true)
    expect(isSelected("Beta")).toBe(true)
    fireEvent.click(del)
    expect(await screen.findByText("Delete 2 history entries?")).toBeInTheDocument()
  })

  it("keeps a private title hashed in the row's aria-label while hidden, and updates it when reveal-all turns on", async () => {
    const user = userEvent.setup()
    serve([entry(1, "Secret One", { blurred: true }), entry(2, "Plain Item")], { privacy: true })
    renderPage()
    await screen.findByText(hashText("Secret One"))
    expect(screen.getByRole("checkbox", { name: `Select ${hashText("Secret One")}` })).toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: /Secret One/ })).toBeNull()
    expect(screen.getByRole("checkbox", { name: "Select Plain Item" })).toBeInTheDocument()

    await user.click(await screen.findByRole("button", { name: "Reveal all private items" }))
    expect(screen.getByRole("checkbox", { name: "Select Secret One" })).toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: `Select ${hashText("Secret One")}` })).toBeNull()

    await user.click(screen.getByRole("button", { name: "Hide all private items" }))
    expect(screen.getByRole("checkbox", { name: `Select ${hashText("Secret One")}` })).toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: /Secret One/ })).toBeNull()
  })
})

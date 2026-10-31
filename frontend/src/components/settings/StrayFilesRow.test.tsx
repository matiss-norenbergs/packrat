import { act, cleanup, fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StrayFilesRow } from "@/components/settings/StrayFilesRow"
import { renderWithProviders } from "@/test/mockApi"
import type { StrayFileEntry, StrayFilesResult } from "@/types/api"

const toastSuccess = vi.fn()
vi.mock("sonner", () => ({ toast: { success: (m: string) => toastSuccess(m), error: vi.fn() } }))

let scanResults: StrayFilesResult[] = []
let delPending = false
const scanMutate = vi.fn((_: undefined, opts?: { onSuccess?: (r: StrayFilesResult) => void }) => {
  const r = scanResults.shift()!
  opts?.onSuccess?.(r)
})
const delMutate = vi.fn()

vi.mock("@/hooks/useMaintenance", () => ({
  useScanStrayFiles: () => ({ mutate: scanMutate, isPending: false }),
  useDeleteStrayFiles: () => ({ mutate: delMutate, isPending: delPending }),
}))

const stray = (i: number, over: Partial<StrayFileEntry> = {}): StrayFileEntry => ({
  root: i % 2 ? "images" : "media",
  path: `dir/file-${i}.mp4`,
  sizeBytes: 1024 * (i + 1),
  modifiedAt: "2026-09-03T10:00:00Z",
  reason: "no db record",
  ...over,
})
const result = (n: number): StrayFilesResult => {
  const entries = Array.from({ length: n }, (_, i) => stray(i))
  return { entries, totals: { count: n, bytes: entries.reduce((s, e) => s + e.sizeBytes, 0) } }
}

const rowEls = () => Array.from(document.querySelectorAll<HTMLElement>("tbody tr[data-row-id]"))
const pick = (i: number, init: MouseEventInit = {}) => fireEvent.mouseDown(rowEls()[i], { button: 0, ...init })

async function openDialog(r: StrayFilesResult) {
  scanResults = [r]
  renderWithProviders(<StrayFilesRow />)
  await userEvent.setup().click(screen.getByRole("button", { name: "Find Stray Files" }))
  return screen.findByRole("dialog")
}

beforeEach(() => {
  scanResults = []
  delPending = false
  scanMutate.mockClear()
  delMutate.mockReset()
  toastSuccess.mockReset()
})
afterEach(() => cleanup())

describe("StrayFilesRow table", () => {
  it("renders the columns and rows with their alignment, and the footer with the count for one page", async () => {
    const dialog = await openDialog(result(3))
    const headers = within(dialog).getAllByRole("columnheader")
    expect(headers.map((h) => h.textContent)).toEqual(["", "Root", "Path", "Reason", "Size", "Modified"])
    expect(headers[4]).toHaveClass("text-right")
    expect(headers[5]).toHaveClass("text-center")

    const cells = within(rowEls()[1]).getAllByRole("cell")
    expect(cells[1]).toHaveTextContent("images")
    expect(cells[1]).toHaveClass("text-muted-foreground")
    expect(cells[2]).toHaveClass("max-w-[280px]", "truncate", "font-medium")
    expect(within(cells[2]).getByTitle("dir/file-1.mp4")).toBeInTheDocument()
    expect(cells[3]).toHaveTextContent("no db record")
    expect(cells[4]).toHaveTextContent("2.0 KB")
    expect(cells[4]).toHaveClass("text-right")
    expect(cells[5]).toHaveTextContent(new Date("2026-09-03T10:00:00Z").toLocaleDateString())
    expect(screen.getByRole("checkbox", { name: "Select dir/file-1.mp4" })).toBeInTheDocument()

    expect(within(dialog).getByText("3 files")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Next" })).toBeDisabled()
    pick(0)
    expect(within(dialog).getByText("3 files · 1 selected")).toBeInTheDocument()
  })

  it("fills the dialog with one scrolling container inside a bordered box", async () => {
    const dialog = await openDialog(result(3))
    const container = within(dialog).getByRole("table").parentElement!
    expect(container).toHaveClass("min-h-0", "flex-1", "overflow-auto")
    expect(container.parentElement).toHaveClass("min-h-0", "flex-1", "overflow-hidden", "rounded-md", "border")
    expect(within(dialog).getAllByRole("columnheader")[0].closest("thead")).toHaveClass("sticky")
  })

  it("shows the count and pager when there are several pages, 50 per page", async () => {
    const dialog = await openDialog(result(120))
    expect(rowEls()).toHaveLength(50)
    expect(within(dialog).getByText("120 files")).toBeInTheDocument()
    pick(0)
    pick(1, { ctrlKey: true })
    expect(within(dialog).getByText("120 files · 2 selected")).toBeInTheDocument()
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "3" }))
    expect(rowEls()).toHaveLength(20)
    expect(within(dialog).getByText("120 files")).toBeInTheDocument() // selection cleared with the page
    expect(within(dialog).getByRole("button", { name: "Delete selected" })).toBeDisabled()
  })

  it("goes back to page 1 when a new scan replaces the result", async () => {
    const dialog = await openDialog(result(120))
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }))
    expect(within(dialog).getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page")
    // Deleting refreshes in place from a fresh scan.
    scanResults = [result(120)]
    pick(0)
    fireEvent.click(within(dialog).getByRole("button", { name: /Delete selected/ }))
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }))
    expect(delMutate).toHaveBeenCalledTimes(1)
    act(() => delMutate.mock.calls[0][1].onSettled())
    expect(within(dialog).getByRole("button", { name: "1" })).toHaveAttribute("aria-current", "page")
    expect(rowEls()[0]).toHaveAttribute("data-row-id", "media:dir/file-0.mp4")
  })
})

describe("StrayFilesRow delete", () => {
  it("deletes exactly the selected entries and reports their size in the confirmation", async () => {
    const dialog = await openDialog(result(4))
    const user = userEvent.setup()
    const deleteBtn = () => within(dialog).getByRole("button", { name: /Delete selected/ })
    expect(deleteBtn()).toBeDisabled()
    pick(0)
    pick(2, { ctrlKey: true })
    expect(deleteBtn()).toHaveTextContent("Delete selected (2)")
    await user.click(deleteBtn())

    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText("Delete 2 stray files?")).toBeInTheDocument()
    // file-0 = 1 KB, file-2 = 3 KB
    expect(confirm).toHaveTextContent("permanently deletes 2 items (4.0 KB)")
    await user.click(within(confirm).getByRole("button", { name: "Delete" }))
    expect(delMutate.mock.calls[0][0]).toEqual([
      { root: "media", path: "dir/file-0.mp4" },
      { root: "media", path: "dir/file-2.mp4" },
    ])
  })

  it("selects by checkbox, by drag and with select-all", async () => {
    const dialog = await openDialog(result(5))
    fireEvent.click(screen.getByRole("checkbox", { name: "Select dir/file-3.mp4" }))
    expect(within(dialog).getByRole("button", { name: "Delete selected (1)" })).toBeInTheDocument()
    pick(1)
    fireEvent.mouseEnter(rowEls()[3])
    fireEvent.mouseUp(window)
    expect(within(dialog).getByRole("button", { name: "Delete selected (3)" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(within(dialog).getByRole("button", { name: "Delete selected (5)" })).toBeInTheDocument()
  })

  it("clears the selection when the dialog is closed and reopened", async () => {
    const dialog = await openDialog(result(3))
    const user = userEvent.setup()
    pick(0)
    expect(within(dialog).getByRole("button", { name: "Delete selected (1)" })).toBeInTheDocument()
    await user.click(within(dialog).getAllByRole("button", { name: "Close" })[0])
    scanResults = [result(3)]
    await user.click(screen.getByRole("button", { name: "Find Stray Files" }))
    expect(await screen.findByRole("button", { name: "Delete selected" })).toBeDisabled()
  })

  it("does not open for a clean scan", async () => {
    scanResults = [{ entries: [], totals: { count: 0, bytes: 0 } }]
    renderWithProviders(<StrayFilesRow />)
    await userEvent.setup().click(screen.getByRole("button", { name: "Find Stray Files" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(toastSuccess).toHaveBeenCalledWith("No stray files found")
  })
})

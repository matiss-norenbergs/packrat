import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useIdSelection } from "@/hooks/useIdSelection"
import { resetFocusReturn } from "@/lib/focusReturn"
import { VIRTUALIZE_THRESHOLD } from "@/lib/windowing"
import { installLayoutMock } from "@/test/layoutMock"
import type { LayoutMock } from "@/test/layoutMock"
import { DataTable } from "./DataTable"
import type { DataTableProps } from "./DataTable"
import type { ColumnDef } from "./types"

vi.mock("@/lib/api", () => ({ fetchTableLayouts: vi.fn(async () => ({})), saveTableLayout: vi.fn(), deleteTableLayout: vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

// Rows are 50px tall under the layout mock, the header 40px, the scroll container 600px: about 12 rows are visible and the
// overscan adds 8 on each side.
const ROW = 50
const HEADER = 40
let rowHeight = ROW
let layout: LayoutMock
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  rowHeight = ROW
  layout = installLayoutMock({ viewportWidth: 1280, viewportHeight: 600, rowHeight: () => rowHeight })
})
afterEach(() => {
  layout.restore()
  resetFocusReturn()
})

interface Row {
  id: number
  name: string
}
const mk = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }))
const getRowId = (r: Row) => r.id
// No sortable / hideable column: the table keeps no layout.
const PLAIN: ColumnDef<Row>[] = [{ key: "n", header: "Name", cell: (r) => r.name }]
const COLUMNS: ColumnDef<Row>[] = [
  { key: "n", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name, width: 200 },
  { key: "x", header: "Extra", label: "Extra", cell: () => "x", hideable: true, width: 100 },
]
const LABEL = { singular: "row", plural: "rows" }

function Harness({ n = 1000, rows, ...props }: { n?: number; rows?: Row[] } & Partial<DataTableProps<Row, number>>) {
  const selection = useIdSelection<number>()
  return (
    <>
      <output data-testid="count">{selection.selected.size}</output>
      <output data-testid="ids">{[...selection.selected].sort((a, b) => a - b).join(",")}</output>
      <DataTable
        rows={rows ?? mk(n)}
        getRowId={getRowId}
        columns={PLAIN}
        selection="multi"
        selectionState={selection}
        getRowLabel={(r) => `Select ${r.name}`}
        virtualize
        estimateRowHeight={ROW}
        {...props}
      />
    </>
  )
}

const container = () => document.querySelector<HTMLElement>('[data-slot="table-container"]')!
const dataRows = () => [...document.querySelectorAll<HTMLElement>("tbody tr[data-row-id]")]
const spacers = () => [...document.querySelectorAll<HTMLElement>("tbody tr[data-windowed-spacer]")]
const spacerHeight = (el: HTMLElement) => parseFloat(el.style.height)
const ids = () => dataRows().map((r) => Number(r.dataset.rowId))
const row = (id: number) => document.querySelector<HTMLElement>(`tr[data-row-id="${id}"]`)!
const count = () => screen.getByTestId("count").textContent
const scrollTo = (top: number) => act(() => layout.scrollTo(container(), top))
const rowTop = (index: number) => HEADER + index * ROW
// The windowed body is a lazy chunk: wait until it replaced the first-window fallback.
const windowed = () => waitFor(() => expect(spacers().length).toBeGreaterThan(0))
// TanStack Virtual keeps `isScrolling` for isScrollingResetDelay (150 ms) after the last scroll event: advance exactly that on fake timers.
const SCROLL_RESET_MS = 150
const settleScroll = () => act(() => vi.advanceTimersByTimeAsync(SCROLL_RESET_MS))

describe("threshold", () => {
  it("renders the plain markup at or below the threshold, and without virtualize however many rows", () => {
    const rows = mk(VIRTUALIZE_THRESHOLD)
    const on = render(<Harness rows={rows} />)
    const off = render(<Harness rows={rows} virtualize={false} />)
    const plain = on.container.innerHTML
    expect(plain).toBe(off.container.innerHTML)
    expect(on.container.querySelectorAll("tbody tr")).toHaveLength(VIRTUALIZE_THRESHOLD)
    expect(on.container.querySelector("[data-windowed-spacer], [aria-rowcount], [aria-rowindex], [data-index]")).toBeNull()
    cleanup()
    render(<Harness n={1000} virtualize={false} />)
    expect(dataRows()).toHaveLength(1000)
  })

  it("windows above the threshold, and a prop moves the threshold", async () => {
    const { rerender } = render(<Harness n={VIRTUALIZE_THRESHOLD + 1} />)
    await windowed()
    expect(dataRows().length).toBeLessThan(VIRTUALIZE_THRESHOLD + 1)
    rerender(<Harness n={VIRTUALIZE_THRESHOLD + 1} virtualizeThreshold={5000} />)
    expect(spacers()).toHaveLength(0)
    expect(dataRows()).toHaveLength(VIRTUALIZE_THRESHOLD + 1)
  })

  it("counts the rows the table renders: a page of a client-side table that is short is plain", async () => {
    const { rerender } = render(<Harness n={1000} pageSize={250} itemLabel={LABEL} />)
    await windowed()
    expect(document.querySelector("table")).toHaveAttribute("aria-rowcount", "251")
    rerender(<Harness n={1000} pageSize={100} itemLabel={LABEL} />)
    expect(spacers()).toHaveLength(0)
    expect(dataRows()).toHaveLength(100)
    expect(document.querySelector("table")).not.toHaveAttribute("aria-rowcount")
  })
})

describe("the window", () => {
  it("mounts a bounded window of rows between a top and a bottom spacer, in row order", async () => {
    render(<Harness n={1000} />)
    await windowed()
    const mounted = ids()
    expect(mounted.length).toBeLessThan(40)
    expect(mounted[0]).toBe(1)
    expect(mounted).toEqual([...mounted].sort((a, b) => a - b))
    const all = [...document.querySelectorAll("tbody tr")]
    expect(spacers()).toHaveLength(2)
    expect(all[0]).toBe(spacers()[0])
    expect(all[all.length - 1]).toBe(spacers()[1])
    // a spacer is one cell spanning the whole table (selection column, name, and the filler that takes the spare width)
    expect(spacers()[0].querySelector("td")).toHaveAttribute("colspan", "3")
    expect(spacers().every((s) => s.getAttribute("aria-hidden") === "true")).toBe(true)
  })

  it("keeps the scroll height: spacers plus the mounted rows are as tall as all the rows", async () => {
    render(<Harness n={1000} />)
    await windowed()
    const total = () => spacers().reduce((t, s) => t + spacerHeight(s), 0) + dataRows().length * ROW
    expect(total()).toBe(1000 * ROW)
    scrollTo(rowTop(400))
    expect(total()).toBe(1000 * ROW)
    expect(spacerHeight(spacers()[0])).toBeGreaterThan(0)
    scrollTo(rowTop(1000))
    expect(total()).toBe(1000 * ROW)
    expect(ids()).toContain(1000)
    expect(spacerHeight(spacers()[1])).toBe(0)
  })

  it("follows the scroll: the first rows leave and the rows at the offset come", async () => {
    render(<Harness n={1000} />)
    await windowed()
    scrollTo(rowTop(500))
    const mounted = ids()
    expect(mounted.length).toBeLessThan(40)
    expect(mounted).not.toContain(1)
    expect(mounted).toContain(501)
    expect(new Set(mounted).size).toBe(mounted.length)
  })

  it("keeps the table's single scroll container and the header outside the window", async () => {
    render(<Harness n={1000} />)
    await windowed()
    expect(container()).toBeInTheDocument()
    expect(container().querySelectorAll("thead")).toHaveLength(1)
    expect(container().querySelectorAll("colgroup col")).toHaveLength(3)
    scrollTo(rowTop(500))
    expect(container().querySelectorAll("thead")).toHaveLength(1)
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument()
  })

  it("last row has no bottom border, as in the plain table", async () => {
    render(<Harness n={300} />)
    await windowed()
    scrollTo(rowTop(300))
    expect(row(300).className).toContain("border-b-0")
    expect(row(299).className).not.toContain("border-b-0")
  })
})

describe("accessibility", () => {
  it("counts all rows and numbers every mounted row by its place among them, the header being row 1", async () => {
    render(<Harness n={1000} />)
    await windowed()
    expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "1001")
    expect(document.querySelector("thead tr")).toHaveAttribute("aria-rowindex", "1")
    expect(row(1)).toHaveAttribute("aria-rowindex", "2")
    scrollTo(rowTop(500))
    expect(row(501)).toHaveAttribute("aria-rowindex", "502")
    scrollTo(rowTop(1000))
    expect(row(1000)).toHaveAttribute("aria-rowindex", "1001")
    for (const r of dataRows()) expect(Number(r.getAttribute("aria-rowindex"))).toBe(Number(r.dataset.rowId) + 1)
  })

  it("does not announce the spacers", async () => {
    render(<Harness n={1000} />)
    await windowed()
    expect(spacers().every((s) => s.getAttribute("aria-hidden") === "true" && !s.hasAttribute("aria-rowindex"))).toBe(true)
  })
})

describe("what stays mounted", () => {
  it("keeps the row with keyboard focus when it scrolls out of the window, and drops it once focus has left", async () => {
    render(<Harness n={1000} />)
    await windowed()
    const box = screen.getByRole("checkbox", { name: "Select Row 3" })
    box.focus()
    expect(document.activeElement).toBe(box)
    scrollTo(rowTop(500))
    expect(box.isConnected).toBe(true)
    expect(document.activeElement).toBe(box)
    expect(ids()).toContain(3)
    expect(ids()).toContain(501)
    expect(ids()).toEqual([...ids()].sort((a, b) => a - b))
    // the rows between the kept one and the window are a spacer of their own
    expect(spacers().length).toBe(3)
    expect(spacers().reduce((t, s) => t + spacerHeight(s), 0) + dataRows().length * ROW).toBe(1000 * ROW)
    box.blur()
    scrollTo(rowTop(502))
    expect(ids()).not.toContain(3)
    expect(spacers()).toHaveLength(2)
  })

  it("keeps the row of the element a closing dialog will give focus back to", async () => {
    render(<Harness n={1000} />)
    await windowed()
    const origin = row(4)
    act(() => void origin.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 })))
    scrollTo(rowTop(500))
    expect(origin.isConnected).toBe(true)
    resetFocusReturn()
    scrollTo(rowTop(501))
    expect(origin.isConnected).toBe(false)
  })
})

describe("scroll reset", () => {
  it("goes back to the top with the window when the resetKey changes, not on a rerender", async () => {
    const { rerender } = render(<Harness n={1000} resetKey="a" />)
    await windowed()
    scrollTo(rowTop(500))
    expect(ids()).not.toContain(1)
    rerender(<Harness n={1000} resetKey="a" />)
    expect(container().scrollTop).toBe(rowTop(500))
    expect(ids()).not.toContain(1)
    rerender(<Harness n={1000} resetKey="b" />)
    expect(container().scrollTop).toBe(0)
    expect(ids()[0]).toBe(1)
    expect(ids()).not.toContain(501)
  })

  it("goes back to the top when a header click sorts (client-side sort)", async () => {
    const { rerender } = render(<Harness n={1000} columns={COLUMNS} />)
    await windowed()
    scrollTo(rowTop(500))
    fireEvent.click(screen.getByRole("button", { name: "Name" }))
    rerender(<Harness n={1000} columns={COLUMNS} />)
    await settleScroll()
    expect(container().scrollTop).toBe(0)
    expect(ids()[0]).toBeLessThan(40)
    expect(ids()).not.toContain(501)
  })

  it("goes back to the top when the page changes (controlled pagination)", async () => {
    const pager = (page: number) => ({ page, pageSize: 1000, total: 3000, onPageChange: () => {}, itemLabel: LABEL })
    const { rerender } = render(<Harness n={1000} pagination={pager(1)} />)
    await windowed()
    scrollTo(rowTop(500))
    expect(ids()).not.toContain(1)
    rerender(<Harness n={1000} pagination={pager(2)} />)
    expect(container().scrollTop).toBe(0)
    expect(ids()[0]).toBe(1)
  })
})

describe("selection over rows that are not mounted", () => {
  it("click selects one row, ctrl-click adds, and the count follows", async () => {
    render(<Harness n={1000} />)
    await windowed()
    fireEvent.mouseDown(row(2))
    fireEvent.mouseUp(window)
    expect(count()).toBe("1")
    scrollTo(rowTop(500))
    fireEvent.mouseDown(row(501), { ctrlKey: true })
    expect(screen.getByTestId("ids").textContent).toBe("2,501")
    expect(row(501)).toHaveAttribute("aria-selected", "true")
  })

  it("shift-click selects the whole range from the anchor, rows that are not mounted included", async () => {
    render(<Harness n={1000} />)
    await windowed()
    fireEvent.mouseDown(row(3))
    fireEvent.mouseUp(window)
    scrollTo(rowTop(700))
    fireEvent.mouseDown(row(701), { shiftKey: true })
    expect(count()).toBe("699")
    // scrolled back, the rows that were not mounted are drawn as selected
    scrollTo(rowTop(300))
    expect(row(301)).toHaveAttribute("data-state", "selected")
  })

  it("the header checkbox selects every row, then clears", async () => {
    render(<Harness n={1000} />)
    await windowed()
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(count()).toBe("1000")
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(count()).toBe("0")
  })

  it("select-all skips the rows isRowSelectable rules out, mounted or not", async () => {
    render(<Harness n={1000} isRowSelectable={(r) => r.id % 2 === 0} />)
    await windowed()
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(count()).toBe("500")
  })

  it("a drag extends the range from the pressed row, by ids", async () => {
    render(<Harness n={1000} />)
    await windowed()
    fireEvent.mouseDown(row(2))
    fireEvent.mouseEnter(row(6))
    expect(screen.getByTestId("ids").textContent).toBe("2,3,4,5,6")
    // the window moves under a pointer that is still down: the rows that mount are entered
    scrollTo(rowTop(60))
    fireEvent.mouseEnter(row(62))
    expect(count()).toBe("61")
    fireEvent.mouseEnter(row(61))
    expect(count()).toBe("60")
    fireEvent.mouseUp(window)
    fireEvent.mouseEnter(row(63))
    expect(count()).toBe("60")
  })

  it("clicking a row's checkbox toggles it without a drag", async () => {
    render(<Harness n={1000} />)
    await windowed()
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Row 5" }))
    expect(screen.getByTestId("ids").textContent).toBe("5")
  })
})

describe("context menu", () => {
  it("opens on a mounted row, selects it first, and acts on it", async () => {
    const onSelect = vi.fn()
    render(<Harness n={1000} contextMenu={(rows) => [{ key: "act", label: `Act on ${rows.length}`, onSelect }]} />)
    await windowed()
    scrollTo(rowTop(500))
    fireEvent.contextMenu(row(502))
    expect(await screen.findByText("Act on 1")).toBeInTheDocument()
    expect(screen.getByTestId("ids").textContent).toBe("502")
    fireEvent.click(screen.getByText("Act on 1"))
    expect(onSelect).toHaveBeenCalledWith([{ id: 502, name: "Row 502" }])
  })
})

describe("row events", () => {
  it("fires onRowClick / onRowDoubleClick and applies rowClassName on mounted rows", async () => {
    const onClick = vi.fn()
    const onDouble = vi.fn()
    render(<Harness n={1000} onRowClick={onClick} onRowDoubleClick={onDouble} rowClassName={(r) => (r.id === 502 ? "marked" : undefined)} />)
    await windowed()
    scrollTo(rowTop(500))
    fireEvent.click(row(502))
    fireEvent.doubleClick(row(502))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick.mock.calls[0][0]).toEqual({ id: 502, name: "Row 502" })
    expect(onDouble).toHaveBeenCalledTimes(1)
    expect(row(502).className).toContain("marked")
  })
})

describe("layout changes", () => {
  it("measures the rows again when the columns change, and the spacers follow", async () => {
    const onLayoutChange = vi.fn()
    const renderIt = (hidden: string[]) => <Harness n={1000} columns={COLUMNS} layout={{ v: 1, hidden }} onLayoutChange={onLayoutChange} />
    const { rerender } = render(renderIt([]))
    await windowed()
    const total = () => spacers().reduce((t, s) => t + spacerHeight(s), 0) + dataRows().length * rowHeight
    expect(total()).toBe(1000 * ROW)
    // with the column gone the remaining ones get the width and every row is a different height
    rowHeight = 80
    rerender(renderIt(["x"]))
    await waitFor(() => expect(total()).toBe(1000 * 80))
  })

  it("keeps the window and the header when a column is hidden or shown", async () => {
    const onLayoutChange = vi.fn()
    const renderIt = (hidden: string[]) => <Harness n={1000} columns={COLUMNS} layout={{ v: 1, hidden }} onLayoutChange={onLayoutChange} />
    const { rerender } = render(renderIt([]))
    await windowed()
    scrollTo(rowTop(500))
    expect(spacers()[0].querySelector("td")).toHaveAttribute("colspan", "4") // selection, name, extra, filler
    rerender(renderIt(["x"]))
    expect(screen.queryByRole("columnheader", { name: "Extra" })).toBeNull()
    expect(container().querySelectorAll("colgroup col")).toHaveLength(3)
    expect(ids()).toContain(501)
    expect(spacers()[0].querySelector("td")).toHaveAttribute("colspan", "3")
    rerender(renderIt([]))
    expect(screen.getByRole("columnheader", { name: "Extra" })).toBeInTheDocument()
  })
})

describe("controlled mode", () => {
  it("windows the rows the page hands over and leaves sorting and slicing to it", async () => {
    const onLayoutChange = vi.fn()
    const rows = mk(1000).reverse()
    render(<Harness rows={rows} columns={COLUMNS} layout={{ v: 1 }} onLayoutChange={onLayoutChange} />)
    await windowed()
    expect(ids()[0]).toBe(1000)
    fireEvent.click(screen.getByRole("button", { name: "Name" }))
    expect(onLayoutChange).toHaveBeenCalled()
    expect(ids()[0]).toBe(1000) // the table never sorts a controlled page's rows
  })

  it("renders the loading skeleton, the error and the empty state instead of the window", async () => {
    const { rerender } = render(<Harness n={1000} loading />)
    expect(dataRows()).toHaveLength(0)
    rerender(<Harness n={1000} error={<p>broken</p>} />)
    expect(screen.getByText("broken")).toBeInTheDocument()
    rerender(<Harness n={0} empty={<p>nothing</p>} />)
    expect(screen.getByText("nothing")).toBeInTheDocument()
    rerender(<Harness n={1000} />)
    await windowed()
    expect(dataRows().length).toBeGreaterThan(0)
  })
})


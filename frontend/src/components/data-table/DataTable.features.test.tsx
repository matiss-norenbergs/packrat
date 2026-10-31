import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useIdSelection } from "@/hooks/useIdSelection"
import { DataTable } from "./DataTable"
import type { DataTableProps } from "./DataTable"
import { TablePagination } from "./TablePagination"
import type { ContextMenuItemDef } from "./types"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

interface Row {
  id: number
  name: string
}
const ROWS: Row[] = ["A", "B", "C", "D"].map((name, i) => ({ id: i + 1, name }))
const COLUMNS = [{ key: "n", header: "Name", cell: (r: Row) => r.name }]
const row = (name: string) => screen.getByText(name).closest("tr")!

function Table(props: Partial<DataTableProps<Row, number>>) {
  const selection = useIdSelection<number>()
  return <DataTable rows={ROWS} getRowId={(r) => r.id} columns={COLUMNS} selectionState={selection} {...props} />
}

describe("DataTable toolbar", () => {
  it("renders the toolbar node, then one right-aligned cluster with filters and search", () => {
    render(<Table toolbar={<button>New</button>} filters={<span>filter</span>} search={{ value: "", onChange: () => {}, placeholder: "Find…" }} />)
    const bar = screen.getByText("New").parentElement!
    const kids = Array.from(bar.children)
    expect(kids).toHaveLength(2)
    expect(kids[0]).toHaveTextContent("New")
    // ml-auto pushes the cluster to the right edge; justify-end keeps its wrapped lines right-aligned too.
    expect(kids[1]).toHaveClass("ml-auto", "flex-wrap", "justify-end")
    const [filters, search] = Array.from(kids[1].children)
    expect(filters).toHaveTextContent("filter")
    expect(search).toContainElement(screen.getByPlaceholderText("Find…"))
    expect(bar).toHaveClass("shrink-0")
  })

  it("puts a lone search in the right-aligned cluster", () => {
    render(<Table search={{ value: "", onChange: () => {} }} />)
    expect(screen.getByPlaceholderText("Search…").parentElement!.parentElement).toHaveClass("ml-auto", "justify-end")
  })

  it("renders no toolbar without slots", () => {
    const { container } = render(<Table />)
    expect(container.querySelector(".shrink-0")).toBeNull()
  })

  it("calls a toolbar function with the selection and selected rows", () => {
    render(
      <Table
        selection="multi"
        toolbar={({ selection, selectedRows }) => (
          <button onClick={() => selection.clear()}>{selectedRows.map((r) => r.name).join("") || "none"}</button>
        )}
      />,
    )
    expect(screen.getByRole("button", { name: "none" })).toBeInTheDocument()
    fireEvent.mouseDown(row("B"))
    fireEvent.mouseUp(window)
    fireEvent.mouseDown(row("D"), { ctrlKey: true })
    fireEvent.click(screen.getByRole("button", { name: "BD" }))
    expect(screen.getByRole("button", { name: "none" })).toBeInTheDocument()
  })
})

describe("DataTable search", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("updates the input immediately and calls onChange debounced (default 300ms)", () => {
    const onChange = vi.fn()
    render(<Table search={{ value: "", onChange }} />)
    const input = screen.getByPlaceholderText("Search…")
    fireEvent.change(input, { target: { value: "a" } })
    fireEvent.change(input, { target: { value: "ab" } })
    expect(input).toHaveValue("ab")
    act(() => void vi.advanceTimersByTime(299))
    expect(onChange).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(1))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith("ab")
  })

  it("honors debounceMs", () => {
    const onChange = vi.fn()
    render(<Table search={{ value: "", onChange, debounceMs: 50 }} />)
    fireEvent.change(screen.getByPlaceholderText("Search…"), { target: { value: "x" } })
    act(() => void vi.advanceTimersByTime(50))
    expect(onChange).toHaveBeenCalledWith("x")
  })

  it("clear button empties the input and applies immediately, dropping the pending call", () => {
    const onChange = vi.fn()
    render(<Table search={{ value: "", onChange }} />)
    const input = screen.getByPlaceholderText("Search…")
    fireEvent.change(input, { target: { value: "abc" } })
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }))
    expect(input).toHaveValue("")
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith("")
    act(() => void vi.advanceTimersByTime(1000))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("does not call onChange on mount", () => {
    const onChange = vi.fn()
    render(<Table search={{ value: "seed", onChange }} />)
    act(() => void vi.advanceTimersByTime(1000))
    expect(screen.getByPlaceholderText("Search…")).toHaveValue("seed")
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe("TablePagination", () => {
  const base = { pageSize: 50, itemLabel: { singular: "tag", plural: "tags" } }

  it("shows the count label with singular/plural", () => {
    const { rerender } = render(<TablePagination {...base} page={1} total={1} onPageChange={() => {}} />)
    expect(screen.getByText("1 tag")).toBeInTheDocument()
    rerender(<TablePagination {...base} page={1} total={190} onPageChange={() => {}} />)
    expect(screen.getByText("190 tags")).toBeInTheDocument()
  })

  it("disables Previous on the first page and Next on the last", () => {
    const { rerender } = render(<TablePagination {...base} page={1} total={120} onPageChange={() => {}} />)
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled()
    rerender(<TablePagination {...base} page={3} total={120} onPageChange={() => {}} />)
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
  })

  it("collapses long ranges with an ellipsis", () => {
    render(<TablePagination {...base} page={1} total={190} onPageChange={() => {}} />)
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Previous", "1", "2", "4", "Next"])
    expect(screen.getByText("…")).toBeInTheDocument()
  })

  it("calls onPageChange for numbers, Previous and Next", async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(<TablePagination {...base} page={2} total={190} onPageChange={onPageChange} />)
    await user.click(screen.getByRole("button", { name: "Next" }))
    await user.click(screen.getByRole("button", { name: "Previous" }))
    await user.click(screen.getByRole("button", { name: "4" }))
    expect(onPageChange.mock.calls.map((c) => c[0])).toEqual([3, 1, 4])
  })

  it("stays visible at total 0 as a single disabled page", () => {
    render(<Table pagination={{ ...base, page: 1, total: 0, onPageChange: () => {} }} rows={[]} />)
    expect(screen.getByText("0 tags")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "1" })).toHaveAttribute("aria-current", "page")
  })

  it("snaps back to the last valid page, once", () => {
    const onPageChange = vi.fn()
    const { rerender } = render(<TablePagination {...base} page={2} total={50} onPageChange={onPageChange} />)
    expect(onPageChange).toHaveBeenCalledTimes(1)
    expect(onPageChange).toHaveBeenCalledWith(1)
    rerender(<TablePagination {...base} page={1} total={50} onPageChange={onPageChange} />)
    expect(onPageChange).toHaveBeenCalledTimes(1)
  })

  it("does not clamp a valid page", () => {
    const onPageChange = vi.fn()
    render(<TablePagination {...base} page={2} total={51} onPageChange={onPageChange} />)
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it("does not clamp while DataTable hides the footer (loading or error)", () => {
    const onPageChange = vi.fn()
    const pagination = { ...base, page: 3, total: 10, onPageChange }
    const { rerender } = render(<Table pagination={pagination} loading />)
    rerender(<Table pagination={pagination} error={<p>x</p>} />)
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it("shows the selected count after the label only in multi mode", () => {
    const pagination = { ...base, page: 1, total: 4, onPageChange: () => {} }
    const { rerender } = render(<Table selection="multi" pagination={pagination} />)
    expect(screen.getByText("4 tags")).toBeInTheDocument()
    fireEvent.mouseDown(row("A"))
    fireEvent.mouseUp(window)
    expect(screen.getByText("4 tags · 1 selected")).toBeInTheDocument()
    fireEvent.mouseDown(row("C"), { ctrlKey: true })
    fireEvent.mouseDown(row("D"), { ctrlKey: true })
    expect(screen.getByText("4 tags · 3 selected")).toBeInTheDocument()
    fireEvent.mouseDown(row("A"), { ctrlKey: true })
    fireEvent.mouseDown(row("C"), { ctrlKey: true })
    fireEvent.mouseDown(row("D"), { ctrlKey: true })
    expect(screen.getByText("4 tags")).toBeInTheDocument()
    rerender(<Table selection="single" pagination={pagination} />)
    fireEvent.mouseDown(row("B"))
    expect(screen.getByText("4 tags")).toBeInTheDocument()
    rerender(<Table selection="none" pagination={pagination} />)
    expect(screen.getByText("4 tags")).toBeInTheDocument()
  })

  it("stays rendered by DataTable while loading or on error, as a disabled placeholder", () => {
    const pagination = { ...base, page: 2, total: 120, onPageChange: () => {} }
    const { rerender } = render(<Table selection="multi" pagination={pagination} />)
    expect(screen.getByText("120 tags")).toBeInTheDocument()
    for (const props of [{ loading: true }, { error: <p>Boom</p> }]) {
      rerender(<Table selection="multi" pagination={{ ...pagination, total: 0 }} rows={[]} {...props} />)
      expect(screen.getByText("—")).toBeInTheDocument()
      expect(screen.queryByText(/tags?$/)).toBeNull()
      expect(screen.queryByText(/selected/)).toBeNull()
      expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
      expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
      const current = screen.getByRole("button", { name: "2" })
      expect(current).toBeDisabled()
      expect(current).toHaveAttribute("aria-current", "page")
      expect(screen.getAllByRole("button", { name: /^\d+$/ })).toHaveLength(1)
    }
  })

  it("does not clamp the page while loading or erroring, only once loaded", () => {
    const onPageChange = vi.fn()
    const pagination = { ...base, page: 3, total: 0, onPageChange }
    const { rerender } = render(<TablePagination {...pagination} loading />)
    expect(onPageChange).not.toHaveBeenCalled()
    rerender(<TablePagination {...pagination} total={0} loading />)
    expect(onPageChange).not.toHaveBeenCalled()
    rerender(<TablePagination {...pagination} total={0} />)
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it("keeps page 3 of a client table while its rows are still loading", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: `R${i}` }))
    const props = { pageSize: 50, itemLabel: { singular: "tag", plural: "tags" } }
    const user = userEvent.setup()
    const { rerender } = render(<Table rows={many} {...props} />)
    await user.click(screen.getByRole("button", { name: "3" }))
    rerender(<Table rows={[]} loading {...props} />)
    expect(screen.getByRole("button", { name: "3" })).toHaveAttribute("aria-current", "page")
    rerender(<Table rows={many} {...props} />)
    expect(screen.getByRole("button", { name: "3" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByText("R100")).toBeInTheDocument()
  })
})

describe("DataTable context menu", () => {
  const menu =
    (spy = vi.fn()) =>
    (rows: Row[]): ContextMenuItemDef<Row>[] => [
      { key: "edit", label: "Edit", disabled: rows.length !== 1, onSelect: spy },
      { key: "sep", separator: true },
      { key: "del", label: `Delete${rows.length > 1 ? ` (${rows.length})` : ""}`, destructive: true, onSelect: spy },
    ]

  it("opens on a row, replacing the selection when the row was not selected", () => {
    const onSelect = vi.fn()
    render(<Table selection="multi" contextMenu={menu(onSelect)} />)
    fireEvent.mouseDown(row("A"))
    fireEvent.mouseUp(window)
    fireEvent.contextMenu(row("C"))
    expect(row("C")).toHaveAttribute("aria-selected", "true")
    expect(row("A")).toHaveAttribute("aria-selected", "false")
    expect(screen.getByRole("menuitem", { name: "Edit" })).not.toHaveAttribute("data-disabled")
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }))
    expect(onSelect).toHaveBeenCalledWith([ROWS[2]])
  })

  it("keeps a multi-selection when right-clicking a selected row", () => {
    const onSelect = vi.fn()
    render(<Table selection="multi" contextMenu={menu(onSelect)} />)
    fireEvent.mouseDown(row("A"))
    fireEvent.mouseUp(window)
    fireEvent.mouseDown(row("C"), { ctrlKey: true })
    fireEvent.contextMenu(row("A"))
    expect(row("C")).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveAttribute("data-disabled")
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete (2)" }))
    expect(onSelect).toHaveBeenCalledWith([ROWS[0], ROWS[2]])
  })

  it("acts on the clicked row alone when selection is none", () => {
    const onSelect = vi.fn()
    render(<Table contextMenu={menu(onSelect)} />)
    fireEvent.contextMenu(row("B"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))
    expect(onSelect).toHaveBeenCalledWith([ROWS[1]])
  })

  it("renders separators", () => {
    render(<Table contextMenu={menu()} />)
    fireEvent.contextMenu(row("B"))
    expect(within(screen.getByRole("menu")).getByRole("separator")).toBeInTheDocument()
  })

  it("never opens from the header", () => {
    render(<Table selection="multi" contextMenu={menu()} />)
    const notPrevented = fireEvent.contextMenu(screen.getByRole("columnheader", { name: "Name" }))
    expect(notPrevented).toBe(false)
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("does not render a menu for an empty table", () => {
    render(<Table rows={[]} contextMenu={menu()} empty={<p>none</p>} />)
    fireEvent.contextMenu(screen.getByText("none"))
    expect(screen.queryByRole("menu")).toBeNull()
  })
})

describe("DataTable row hooks", () => {
  it("fires click and double-click handlers with the row", () => {
    const onRowClick = vi.fn()
    const onRowDoubleClick = vi.fn()
    render(<Table onRowClick={onRowClick} onRowDoubleClick={onRowDoubleClick} />)
    fireEvent.click(row("B"))
    fireEvent.doubleClick(row("C"))
    expect(onRowClick.mock.calls[0][0]).toBe(ROWS[1])
    expect(onRowDoubleClick.mock.calls[0][0]).toBe(ROWS[2])
    expect(row("B")).toHaveClass("cursor-pointer")
  })
})

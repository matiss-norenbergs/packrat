import { useState } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useIdSelection } from "@/hooks/useIdSelection"
import { DataTable } from "./DataTable"
import type { DataTableProps } from "./DataTable"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

interface Row {
  id: number
  name: string
}
const ROWS: Row[] = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: i === 2 ? "Café Beta" : `Item ${i + 1}` }))
const COLUMNS = [{ key: "n", header: "Name", cell: (r: Row) => r.name }]
const LABEL = { singular: "item", plural: "items" }
const match = (r: Row, q: string) => r.name.toLowerCase().includes(q)
const row = (name: string) => screen.getByText(name).closest("tr")!
const names = () => screen.getAllByRole("row").slice(1).map((r) => r.textContent)

function Harness(props: Partial<DataTableProps<Row, number>> & { onSel?: (ids: number[]) => void }) {
  const selection = useIdSelection<number>()
  props.onSel?.(Array.from(selection.selected))
  return (
    <DataTable
      rows={ROWS}
      getRowId={(r) => r.id}
      columns={COLUMNS}
      selection="multi"
      selectionState={selection}
      pageSize={3}
      itemLabel={LABEL}
      search={{ value: "", match }}
      {...props}
    />
  )
}

const type = (v: string) => {
  fireEvent.change(screen.getByPlaceholderText("Search…"), { target: { value: v } })
  act(() => void vi.advanceTimersByTime(300))
}

beforeEach(() => {
  vi.useFakeTimers()
})

describe("DataTable client-side mode", () => {
  it("slices rows by pageSize and reports the total", () => {
    render(<Harness />)
    expect(names()).toEqual(["Item 1", "Item 2", "Café Beta"].map((n) => n))
    expect(screen.getByText("7 items")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    expect(names()).toEqual(["Item 4", "Item 5", "Item 6"])
  })

  it("filters case-insensitively through the normalized query; footer shows the filtered count", () => {
    render(<Harness />)
    type("  CAFÉ ")
    expect(names()).toEqual(["Café Beta"])
    expect(screen.getByText("1 item")).toBeInTheDocument()
  })

  it("treats a whitespace-only query as no filter and passes match a normalized query", () => {
    const spy = vi.fn(match)
    render(<Harness search={{ value: "", match: spy }} />)
    type("   ")
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByText("7 items")).toBeInTheDocument()
    type(" ITEM 1 ")
    expect(spy).toHaveBeenCalledWith(ROWS[0], "item 1")
  })

  it("resets to page 1 when the query changes", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "3" }))
    expect(names()).toEqual(["Item 7"])
    type("item")
    expect(names()).toEqual(["Item 1", "Item 2", "Item 4"])
    expect(screen.getByRole("button", { name: "1" })).toHaveAttribute("aria-current", "page")
  })

  it("clears the selection on a page change and on a query change", () => {
    let ids: number[] = []
    render(<Harness onSel={(s) => (ids = s)} />)
    fireEvent.mouseDown(row("Item 1"))
    fireEvent.mouseUp(window)
    expect(ids).toEqual([1])
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    expect(ids).toEqual([])
    fireEvent.mouseDown(row("Item 4"))
    fireEvent.mouseUp(window)
    expect(ids).toEqual([4])
    type("item")
    expect(ids).toEqual([])
  })

  it("does not re-run match when only the selection changes", () => {
    const spy = vi.fn(match)
    render(<Harness search={{ value: "", match: spy }} />)
    type("item")
    const calls = spy.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    fireEvent.mouseDown(row("Item 1"))
    fireEvent.mouseUp(window)
    fireEvent.mouseDown(row("Item 2"), { ctrlKey: true })
    expect(spy.mock.calls.length).toBe(calls)
  })

  it("passes the query to a function empty prop (raw, as typed)", () => {
    render(<Harness empty={(q) => <p>{q ? `No match "${q}"` : "Nothing yet"}</p>} />)
    type("ZZ")
    expect(screen.getByText('No match "ZZ"')).toBeInTheDocument()
    expect(screen.getByText("0 items")).toBeInTheDocument() // footer stays at 0
  })

  it("shows a node empty prop and the unfiltered-empty case", () => {
    render(<Harness rows={[]} empty={(q) => <p>{q ? "none match" : "Nothing yet"}</p>} />)
    expect(screen.getByText("Nothing yet")).toBeInTheDocument()
  })

  it("snaps back when the last row of the last page disappears", () => {
    function Shrinking() {
      const [rows, setRows] = useState(ROWS)
      return (
        <>
          <button onClick={() => setRows(ROWS.slice(0, 6))}>shrink</button>
          <Harness rows={rows} />
        </>
      )
    }
    render(<Shrinking />)
    fireEvent.click(screen.getByRole("button", { name: "3" }))
    fireEvent.click(screen.getByText("shrink"))
    expect(names()).toEqual(["Item 4", "Item 5", "Item 6"])
    expect(screen.getByText("6 items")).toBeInTheDocument()
  })

  it("exposes query and total to the toolbar slot", () => {
    render(<Harness toolbar={({ query, total }) => <span>{`q=${query};n=${total}`}</span>} />)
    expect(screen.getByText("q=;n=7")).toBeInTheDocument()
    type("item")
    expect(screen.getByText("q=item;n=6")).toBeInTheDocument()
  })

  it("works with string ids", () => {
    render(
      <DataTable
        rows={[{ id: "a/1", n: "one" }, { id: "a/2", n: "two" }, { id: "a/3", n: "three" }]}
        getRowId={(r: { id: string; n: string }) => r.id}
        columns={[{ key: "n", header: "N", cell: (r: { id: string; n: string }) => r.n }]}
        pageSize={2}
        itemLabel={LABEL}
        search={{ value: "", match: (r: { n: string }, q: string) => r.n.includes(q) }}
      />,
    )
    type("t")
    expect(names()).toEqual(["two", "three"])
  })
})

describe("DataTable footerClearsDock", () => {
  const footerRow = () => screen.getByText(/^7 items/).parentElement!
  const footerLabel = () => screen.getByText(/^7 items/)

  it("indents the count and lets the footer wrap above the dock", () => {
    render(<Harness footerClearsDock />)
    expect(footerRow()).toHaveClass("flex", "shrink-0", "flex-wrap-reverse", "items-center", "justify-between", "gap-2")
    expect(footerLabel()).toHaveClass("flex", "min-h-9", "items-center", "pl-12", "text-sm", "text-muted-foreground", "md:min-h-0")
  })

  it("leaves the footer markup unchanged without it", () => {
    render(<Harness />)
    expect(footerRow().className).toBe("flex shrink-0 items-center justify-between")
    expect(footerLabel().className).toBe("text-sm text-muted-foreground")
  })
})

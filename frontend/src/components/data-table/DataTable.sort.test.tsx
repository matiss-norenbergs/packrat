import { useState } from "react"
import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useIdSelection } from "@/hooks/useIdSelection"
import { tableLayoutsQueryKey } from "@/hooks/useTableLayout"
import type { TableLayout, TableLayouts } from "@/types/api"
import { DataTable } from "./DataTable"
import type { DataTableProps } from "./DataTable"
import type { ColumnDef } from "./types"

const api = vi.hoisted(() => ({ fetchTableLayouts: vi.fn(), saveTableLayout: vi.fn(), deleteTableLayout: vi.fn() }))
vi.mock("@/lib/api", () => api)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

interface Row {
  id: number
  name: string
  count: number | null
}
// Natural order (by id): c, a, d, b, e. By name: a b c d e. By count (asc): b(1) a(2) c(10) d(10) e(null).
const ROWS: Row[] = [
  { id: 1, name: "c", count: 10 },
  { id: 2, name: "a", count: 2 },
  { id: 3, name: "d", count: 10 },
  { id: 4, name: "b", count: 1 },
  { id: 5, name: "e", count: null },
]
const COLUMNS: ColumnDef<Row>[] = [
  { key: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
  { key: "count", header: "Count", type: "number", cell: (r) => String(r.count), sortValue: (r) => r.count },
  { key: "plain", header: "Plain", cell: () => "-", hideable: true },
]
const LABEL = { singular: "item", plural: "items" }
// The name column is the third from last (a selection checkbox column may precede it).
const names = () => screen.getAllByRole("row").slice(1).map((r) => Array.from(r.querySelectorAll("td")).at(-3)!.textContent)

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(tableLayoutsQueryKey, {} satisfies TableLayouts)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

// The page owns the layout, as a server-paged page or the Library list would.
function Controlled(props: Partial<DataTableProps<Row, number>> & { initial?: TableLayout; onLayout?: (l: TableLayout) => void }) {
  const { initial = { v: 1 }, onLayout, ...rest } = props
  const [layout, setLayout] = useState<TableLayout>(initial)
  return (
    <DataTable
      rows={ROWS}
      getRowId={(r) => r.id}
      columns={COLUMNS}
      layout={layout}
      onLayoutChange={(l) => {
        onLayout?.(l)
        setLayout(l)
      }}
      {...rest}
    />
  )
}

beforeEach(() => {
  api.fetchTableLayouts.mockReset().mockResolvedValue({})
})
afterEach(cleanup)

describe("DataTable sorting (client mode)", () => {
  it("shows the natural order when the layout has no sort", () => {
    render(wrap(<Controlled pageSize={50} itemLabel={LABEL} />))
    expect(names()).toEqual(["c", "a", "d", "b", "e"])
  })

  it("sorts by the layout's sort, nulls last in both directions, ties in the original order", () => {
    const { unmount } = render(wrap(<Controlled pageSize={50} itemLabel={LABEL} initial={{ v: 1, sort: { key: "count", dir: "asc" } }} />))
    expect(names()).toEqual(["b", "a", "c", "d", "e"])
    unmount()
    render(wrap(<Controlled pageSize={50} itemLabel={LABEL} initial={{ v: 1, sort: { key: "count", dir: "desc" } }} />))
    expect(names()).toEqual(["c", "d", "a", "b", "e"])
  })

  it("uses defaultSort while the layout has no sort", () => {
    render(wrap(<Controlled pageSize={50} itemLabel={LABEL} defaultSort={{ key: "name", dir: "desc" }} />))
    expect(names()).toEqual(["e", "d", "c", "b", "a"])
  })

  it("ignores a sort on a column that is not sortable", () => {
    render(wrap(<Controlled pageSize={50} itemLabel={LABEL} initial={{ v: 1, sort: { key: "plain", dir: "asc" } }} />))
    expect(names()).toEqual(["c", "a", "d", "b", "e"])
  })

  it("sorts the filtered rows before paging", () => {
    const match = (r: Row, q: string) => r.name !== q
    render(wrap(<Controlled pageSize={2} itemLabel={LABEL} search={{ value: "", match }} initial={{ v: 1, sort: { key: "name", dir: "asc" } }} />))
    expect(names()).toEqual(["a", "b"])
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    expect(names()).toEqual(["c", "d"])
  })

  it("goes back to page 1 and clears the selection when the sort changes from outside", () => {
    let selected: number[] = []
    function Page() {
      const selection = useIdSelection<number>()
      const [layout, setLayout] = useState<TableLayout>({ v: 1 })
      selected = Array.from(selection.selected)
      return (
        <>
          <button onClick={() => setLayout({ v: 1, sort: { key: "name", dir: "desc" } })}>sort</button>
          <button onClick={() => setLayout({ v: 1 })}>unsort</button>
          <DataTable
            rows={ROWS}
            getRowId={(r) => r.id}
            columns={COLUMNS}
            selection="multi"
            selectionState={selection}
            pageSize={2}
            itemLabel={LABEL}
            layout={layout}
            onLayoutChange={setLayout}
          />
        </>
      )
    }
    render(wrap(<Page />))
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row 3" }))
    expect(names()).toEqual(["d", "b"])
    expect(selected).toEqual([3])

    fireEvent.click(screen.getByText("sort"))
    expect(names()).toEqual(["e", "d"])
    expect(selected).toEqual([])

    fireEvent.click(screen.getByRole("button", { name: "2" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row 1" }))
    fireEvent.click(screen.getByText("unsort"))
    expect(names()).toEqual(["c", "a"])
    expect(selected).toEqual([])
  })

  it("does not sort rows in controlled (server) mode, whatever the layout says", () => {
    render(wrap(<Controlled initial={{ v: 1, sort: { key: "name", dir: "asc" } }} pagination={{ page: 1, pageSize: 50, total: 5, onPageChange: () => {}, itemLabel: LABEL }} />))
    expect(names()).toEqual(["c", "a", "d", "b", "e"])
  })
})

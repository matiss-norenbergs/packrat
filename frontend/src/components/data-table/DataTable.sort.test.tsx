import { useState } from "react"
import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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
const names = () => screen.getAllByRole("row").slice(1).map((r) => Array.from(r.querySelectorAll("td:not([aria-hidden])")).at(-3)!.textContent)

function wrap(children: ReactNode, saved: TableLayouts = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(tableLayoutsQueryKey, saved)
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
  api.saveTableLayout.mockReset().mockImplementation(async (_id: string, l: TableLayout) => l)
  api.deleteTableLayout.mockReset().mockResolvedValue(undefined)
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

const header = (name: string) => screen.getByRole("columnheader", { name })
const sortButton = (name: string) => screen.getByRole("button", { name })
const click = (name: string) => fireEvent.click(sortButton(name))
const aria = (name: string) => header(name).getAttribute("aria-sort")
const arrowOf = (name: string) =>
  sortButton(name).querySelector("svg.lucide-arrow-up") ? "up" : sortButton(name).querySelector("svg.lucide-arrow-down") ? "down" : null
const layoutButton = () => screen.queryByRole("button", { name: "Table layout" })
const columnsButton = () => screen.queryByRole("button", { name: "Columns" })
const dot = () => screen.queryByTestId("layout-dirty-dot")

function Client(props: Partial<DataTableProps<Row, number>>) {
  return <DataTable rows={ROWS} getRowId={(r) => r.id} columns={COLUMNS} pageSize={50} itemLabel={LABEL} {...props} />
}

describe("DataTable sortable headers", () => {
  it("renders a button with the header in sortable columns only, and aria-sort on the th", () => {
    render(wrap(<Client tableId="t" />))
    expect(sortButton("Name")).toHaveAttribute("type", "button")
    expect(sortButton("Count")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Plain" })).toBeNull()
    expect(header("Plain").hasAttribute("aria-sort")).toBe(false)
    expect(header("Plain").querySelector("button")).toBeNull()
    expect(aria("Name")).toBe("none")
    expect(arrowOf("Name")).toBeNull()
  })

  it("cycles asc -> desc -> off without a default sort, with an arrow per direction", () => {
    render(wrap(<Client tableId="t" />))
    click("Name")
    expect(names()).toEqual(["a", "b", "c", "d", "e"])
    expect([aria("Name"), arrowOf("Name")]).toEqual(["ascending", "up"])
    click("Name")
    expect(names()).toEqual(["e", "d", "c", "b", "a"])
    expect([aria("Name"), arrowOf("Name")]).toEqual(["descending", "down"])
    click("Name")
    expect(names()).toEqual(["c", "a", "d", "b", "e"])
    expect([aria("Name"), arrowOf("Name")]).toEqual(["none", null])
  })

  it("moves the sort to the clicked column", () => {
    render(wrap(<Client tableId="t" />))
    click("Name")
    click("Count")
    expect(names()).toEqual(["b", "a", "c", "d", "e"])
    expect([aria("Name"), aria("Count")]).toEqual(["none", "ascending"])
  })

  it("with a desc default: shows its arrow, toggles between the two directions and other columns return to it", () => {
    render(wrap(<Client tableId="t" defaultSort={{ key: "name", dir: "desc" }} />))
    expect(names()).toEqual(["e", "d", "c", "b", "a"])
    expect([aria("Name"), arrowOf("Name")]).toEqual(["descending", "down"])
    expect(dot()).toBeNull()
    click("Name")
    expect(names()).toEqual(["a", "b", "c", "d", "e"])
    click("Name")
    expect(names()).toEqual(["e", "d", "c", "b", "a"])
    expect(dot()).toBeNull()
    click("Count")
    click("Count")
    click("Count")
    expect(names()).toEqual(["e", "d", "c", "b", "a"])
    expect(aria("Name")).toBe("descending")
  })

  it("with an asc default: toggles the default column between its two directions", () => {
    render(wrap(<Client tableId="t" defaultSort={{ key: "name", dir: "asc" }} />))
    expect(names()).toEqual(["a", "b", "c", "d", "e"])
    click("Name")
    expect(names()).toEqual(["e", "d", "c", "b", "a"])
    click("Name")
    expect(names()).toEqual(["a", "b", "c", "d", "e"])
    expect(aria("Name")).toBe("ascending")
  })

  it("puts the arrow before the label in right-aligned columns and after it otherwise; centered ones keep a spacer", () => {
    const cols: ColumnDef<Row>[] = [
      { key: "l", header: "Left", cell: () => "", sortValue: (r) => r.name },
      { key: "c", header: "Center", type: "date", cell: () => "", sortValue: (r) => r.name },
      { key: "r", header: "Right", type: "number", cell: () => "", sortValue: (r) => r.name },
    ]
    render(wrap(<Client tableId="t" columns={cols} />))
    const kids = (n: string) =>
      Array.from(sortButton(n).childNodes).map((c) => ((c as Element).classList.contains("truncate") ? "text" : (c as Element).tagName.toLowerCase() === "svg" ? "arrow" : "spacer"))
    click("Left")
    expect(kids("Left")).toEqual(["text", "arrow"])
    expect(kids("Center")).toEqual(["spacer", "text", "spacer"])
    click("Center")
    expect(kids("Center")).toEqual(["spacer", "text", "arrow"])
    click("Right")
    expect(kids("Right")).toEqual(["arrow", "text"])
    expect(kids("Left")).toEqual(["text"])
  })

  it("does not select a row when the header is clicked", () => {
    render(wrap(<Client tableId="t" selection="multi" />))
    click("Name")
    expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0)
  })

  it("can be operated with the keyboard", async () => {
    const user = userEvent.setup()
    render(wrap(<Client tableId="t" />))
    sortButton("Name").focus()
    expect(sortButton("Name")).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(names()).toEqual(["a", "b", "c", "d", "e"])
    await user.keyboard(" ")
    expect(names()).toEqual(["e", "d", "c", "b", "a"])
  })

  it("goes back to page 1 and clears the selection on a header click", () => {
    function Page() {
      const selection = useIdSelection<number>()
      return <Client tableId="t" pageSize={2} selection="multi" selectionState={selection} />
    }
    render(wrap(<Page />))
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row 3" }))
    expect(screen.getByRole("checkbox", { name: "Select row 3" })).toBeChecked()
    click("Name")
    expect(names()).toEqual(["a", "b"])
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0)
  })
})

describe("DataTable layout button with sortable columns", () => {
  const sortOnly = COLUMNS.filter((c) => c.key !== "plain")
  const hideOnly: ColumnDef<Row>[] = [
    { key: "name", header: "Name", cell: (r) => r.name },
    { key: "plain", header: "Plain", cell: () => "-", hideable: true },
  ]
  const neither: ColumnDef<Row>[] = [{ key: "name", header: "Name", cell: (r) => r.name }]

  it("shows Layout only (a group of one) for sortable columns", () => {
    render(wrap(<Client tableId="t" columns={sortOnly} />))
    expect(layoutButton()).toBeInTheDocument()
    expect(columnsButton()).toBeNull()
    expect(screen.getByRole("group")).toBeInTheDocument()
  })
  it("shows both when there are sortable and hideable columns", () => {
    render(wrap(<Client tableId="t" />))
    expect(layoutButton()).toBeInTheDocument()
    expect(columnsButton()).toBeInTheDocument()
  })
  it("shows both for hideable-only columns with a tableId", () => {
    render(wrap(<Client tableId="t" columns={hideOnly} />))
    expect(layoutButton()).toBeInTheDocument()
    expect(columnsButton()).toBeInTheDocument()
  })
  it("shows no Layout button without a tableId, and Columns only with a hideable column", () => {
    const { unmount } = render(wrap(<Client columns={sortOnly} />))
    expect(layoutButton()).toBeNull()
    expect(columnsButton()).toBeNull()
    expect(sortButton("Name")).toBeInTheDocument()
    unmount()
    render(wrap(<Client />))
    expect(layoutButton()).toBeNull()
    expect(columnsButton()).toBeInTheDocument()
  })
  it("shows Layout only (the column is resizable) for plain columns with a tableId", () => {
    render(wrap(<Client tableId="t" columns={neither} />))
    expect(layoutButton()).toBeInTheDocument()
    expect(columnsButton()).toBeNull()
    expect(document.querySelectorAll("th button")).toHaveLength(0)
  })
  it("renders neither, and no header buttons, for columns that cannot be hidden, sorted or resized", () => {
    render(wrap(<Client tableId="t" columns={neither.map((c) => ({ ...c, resizable: false }))} />))
    expect(layoutButton()).toBeNull()
    expect(columnsButton()).toBeNull()
    expect(document.querySelectorAll("th button")).toHaveLength(0)
  })
})

describe("DataTable sort in the saved layout", () => {
  async function openLayout(user: ReturnType<typeof userEvent.setup>) {
    await user.click(layoutButton()!)
    return await screen.findByRole("dialog")
  }

  it("is a working draft: the dot shows after a sort change and Save PUTs it", async () => {
    const user = userEvent.setup()
    render(wrap(<Client tableId="t" />))
    expect(dot()).toBeNull()
    click("Name")
    expect(dot()).toBeInTheDocument()
    expect(api.saveTableLayout).not.toHaveBeenCalled()
    await openLayout(user)
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(api.saveTableLayout).toHaveBeenCalledWith("t", { v: 1, sort: { key: "name", dir: "asc" } })
  })

  it("starts from the saved sort, and Restore saved returns to it", async () => {
    const user = userEvent.setup()
    render(wrap(<Client tableId="t" />, { t: { v: 1, sort: { key: "count", dir: "desc" } } }))
    expect(names()).toEqual(["c", "d", "a", "b", "e"])
    expect(dot()).toBeNull()
    click("Name")
    expect(dot()).toBeInTheDocument()
    await openLayout(user)
    await user.click(screen.getByRole("button", { name: "Restore saved" }))
    expect(names()).toEqual(["c", "d", "a", "b", "e"])
    expect(dot()).toBeNull()
  })

  it("Clear deletes the saved layout and returns to the default order", async () => {
    const user = userEvent.setup()
    render(wrap(<Client tableId="t" defaultSort={{ key: "name", dir: "desc" }} />, { t: { v: 1, sort: { key: "count", dir: "asc" } } }))
    expect(names()).toEqual(["b", "a", "c", "d", "e"])
    await openLayout(user)
    await user.click(screen.getByRole("button", { name: "Clear saved layout" }))
    await waitFor(() => expect(api.deleteTableLayout).toHaveBeenCalledWith("t"))
    await waitFor(() => expect(names()).toEqual(["e", "d", "c", "b", "a"]))
    expect(dot()).toBeNull()
  })

  it("Restore defaults (nothing saved) returns to the default order", async () => {
    const user = userEvent.setup()
    render(wrap(<Client tableId="t" defaultSort={{ key: "name", dir: "desc" }} />))
    click("Count")
    expect(names()).toEqual(["b", "a", "c", "d", "e"])
    await openLayout(user)
    await user.click(screen.getByRole("button", { name: "Restore defaults" }))
    expect(names()).toEqual(["e", "d", "c", "b", "a"])
    expect(dot()).toBeNull()
  })

  it("treats a saved layout without sort as the default order, and a saved sort equal to the default as clean", () => {
    const { unmount } = render(wrap(<Client tableId="t" defaultSort={{ key: "name", dir: "desc" }} />, { t: { v: 1, hidden: [] } }))
    expect(names()).toEqual(["e", "d", "c", "b", "a"])
    expect(dot()).toBeNull()
    unmount()
    render(wrap(<Client tableId="t" defaultSort={{ key: "name", dir: "desc" }} />, { t: { v: 1, sort: { key: "name", dir: "desc" } } }))
    expect(dot()).toBeNull()
  })

  it("controlled/server mode reports the sort through onLayoutChange and leaves the rows alone", () => {
    const seen: TableLayout[] = []
    render(
      wrap(
        <Controlled
          onLayout={(l) => seen.push(l)}
          tableId="t"
          pagination={{ page: 1, pageSize: 50, total: 5, onPageChange: () => {}, itemLabel: LABEL }}
        />,
      ),
    )
    click("Count")
    click("Count")
    click("Count")
    expect(seen).toEqual([{ v: 1, sort: { key: "count", dir: "asc" } }, { v: 1, sort: { key: "count", dir: "desc" } }, { v: 1 }])
    expect(names()).toEqual(["c", "a", "d", "b", "e"])
  })
})

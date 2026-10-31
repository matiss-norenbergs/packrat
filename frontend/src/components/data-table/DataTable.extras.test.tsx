import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { tableLayoutsQueryKey } from "@/hooks/useTableLayout"
import type { TableLayout, TableLayouts } from "@/types/api"
import { Button } from "@/components/ui/button"
import { DataTable } from "./DataTable"
import type { ColumnDef } from "./types"

const api = vi.hoisted(() => ({ fetchTableLayouts: vi.fn(), saveTableLayout: vi.fn(), deleteTableLayout: vi.fn() }))
vi.mock("@/lib/api", () => api)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

interface Row {
  id: number
  name: string
}
const ROWS: Row[] = ["B", "A", "C"].map((name, i) => ({ id: i + 1, name }))
const COLUMNS: ColumnDef<Row>[] = [{ key: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name }]
const DEFAULT_SORT = { key: "name", dir: "asc" as const }

beforeEach(() => {
  api.fetchTableLayouts.mockReset().mockResolvedValue({})
  api.saveTableLayout.mockReset().mockImplementation(async (_id: string, l: TableLayout) => l)
  api.deleteTableLayout.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe("DataTable selectedCount", () => {
  const columns = COLUMNS.map(({ sortValue: _s, ...c }) => c)
  const renderFooter = (selectedCount?: number) =>
    render(
      <DataTable
        rows={ROWS}
        getRowId={(r) => r.id}
        columns={columns}
        selection="multi"
        selectedCount={selectedCount}
        pagination={{ page: 1, pageSize: 50, total: 3, onPageChange: () => {}, itemLabel: { singular: "item", plural: "items" } }}
      />,
    )

  it("shows the override instead of the selected rows on the page", async () => {
    const user = userEvent.setup()
    renderFooter(7)
    expect(screen.getByText("3 items · 7 selected")).toBeInTheDocument()
    await user.click(screen.getByRole("checkbox", { name: "Select row 1" }))
    expect(screen.getByText("3 items · 7 selected")).toBeInTheDocument()
  })

  it("shows nothing for 0, even with rows selected on the page", async () => {
    const user = userEvent.setup()
    renderFooter(0)
    await user.click(screen.getByRole("checkbox", { name: "Select row 1" }))
    expect(screen.getByText("3 items")).toBeInTheDocument()
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it("counts the selected rows of the page when it is not given", async () => {
    const user = userEvent.setup()
    renderFooter(undefined)
    await user.click(screen.getByRole("checkbox", { name: "Select row 1" }))
    expect(screen.getByText("3 items · 1 selected")).toBeInTheDocument()
  })
})

describe("DataTable extraSortKeys", () => {
  function Controlled({ saved, initial, extra }: { saved: TableLayouts; initial: TableLayout; extra?: string[] }) {
    const [layout, setLayout] = useState(initial)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(tableLayoutsQueryKey, saved)
    return (
      <QueryClientProvider client={client}>
        <DataTable
          rows={ROWS}
          getRowId={(r) => r.id}
          columns={COLUMNS}
          tableId="t"
          layout={layout}
          onLayoutChange={setLayout}
          defaultSort={DEFAULT_SORT}
          extraSortKeys={extra}
        />
        <output data-testid="layout">{JSON.stringify(layout)}</output>
      </QueryClientProvider>
    )
  }
  const nameHeader = () => screen.getByRole("columnheader", { name: "Name" })

  it("keeps a saved layout sorted by an extra key: not dirty, and no column shows a sort", () => {
    render(<Controlled saved={{ t: { v: 1, sort: { key: "filename", dir: "desc" } } }} initial={{ v: 1, sort: { key: "filename", dir: "desc" } }} extra={["filename"]} />)
    expect(screen.queryByTestId("layout-dirty-dot")).toBeNull()
    expect(nameHeader()).toHaveAttribute("aria-sort", "none")
    expect(document.querySelector("th svg")).toBeNull()
  })

  it("sorts no rows by it", () => {
    render(<Controlled saved={{}} initial={{ v: 1, sort: { key: "filename", dir: "asc" } }} extra={["filename"]} />)
    const names = Array.from(document.querySelectorAll("td[data-col=name]")).map((c) => c.textContent)
    expect(names).toEqual(["B", "A", "C"])
  })

  it("without the key a working sort by it is normalized away: not dirty, nothing to save", () => {
    render(<Controlled saved={{}} initial={{ v: 1, sort: { key: "filename", dir: "desc" } }} />)
    expect(screen.queryByTestId("layout-dirty-dot")).toBeNull()
  })

  it("is dirty when the working sort is an extra key and Save sends it", async () => {
    const user = userEvent.setup()
    render(<Controlled saved={{}} initial={{ v: 1, sort: { key: "sequenceNumber", dir: "desc" } }} extra={["filename", "sequenceNumber"]} />)
    expect(screen.getByTestId("layout-dirty-dot")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Table layout" }))
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }))
    expect(api.saveTableLayout).toHaveBeenCalledWith("t", { v: 1, sort: { key: "sequenceNumber", dir: "desc" } })
  })

  it("a header click moves on from an extra-key sort to that column ascending", async () => {
    const user = userEvent.setup()
    render(<Controlled saved={{}} initial={{ v: 1, sort: { key: "filename", dir: "desc" } }} extra={["filename"]} />)
    await user.click(within(nameHeader()).getByRole("button"))
    // Name asc is the table's default order, which is stored as "no sort".
    expect(JSON.parse(screen.getByTestId("layout").textContent!)).toEqual({ v: 1 })
  })
})

describe("DataTable layoutActions", () => {
  const plain = COLUMNS.map(({ sortValue: _s, ...c }) => c)
  const actions = <Button variant="outline" size="icon-sm" aria-label="Display settings" />

  it("renders inside the button group after Columns and Layout", () => {
    const hideable = [...plain, { key: "other", header: "Other", cell: () => "x", hideable: true }]
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DataTable rows={ROWS} getRowId={(r) => r.id} columns={hideable} tableId="t" layoutActions={actions} />
      </QueryClientProvider>,
    )
    const group = screen.getByRole("group")
    expect(within(group).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Columns", "Table layout", "Display settings"])
  })

  it("alone it still shows the toolbar and right-aligns the group", () => {
    render(<DataTable rows={ROWS} getRowId={(r) => r.id} columns={plain} layoutActions={actions} />)
    const group = screen.getByRole("group")
    expect(within(group).getByRole("button", { name: "Display settings" })).toBeInTheDocument()
    expect(group.parentElement).toHaveClass("ml-auto", "flex-wrap", "justify-end")
  })

  it("is absent when omitted", () => {
    render(<DataTable rows={ROWS} getRowId={(r) => r.id} columns={plain} />)
    expect(screen.queryByRole("group")).toBeNull()
    expect(screen.queryByRole("button", { name: "Display settings" })).toBeNull()
  })
})

describe("DataTable defaultHiddenWhenUnset", () => {
  const cols: ColumnDef<Row>[] = [
    { key: "name", header: "Name", cell: (r) => r.name },
    { key: "a", header: "A", cell: () => "a", hideable: true, defaultVisible: false },
    { key: "b", header: "B", cell: () => "b", hideable: true },
  ]
  const headers = () => Array.from(document.querySelectorAll("th:not([aria-hidden])")).map((h) => h.textContent)
  function renderWith(stored: TableLayout, flag: boolean) {
    const client = new QueryClient()
    client.setQueryData(tableLayoutsQueryKey, { t: stored })
    render(
      <QueryClientProvider client={client}>
        <DataTable rows={ROWS} getRowId={(r) => r.id} columns={cols} tableId="t" defaultHiddenWhenUnset={flag} />
      </QueryClientProvider>,
    )
  }

  it("a stored layout without hidden keeps the default hidden columns, and is not dirty", () => {
    renderWith({ v: 1, widths: { name: 300 } }, true)
    expect(headers()).toEqual(["Name", "B"])
    expect(screen.queryByTestId("layout-dirty-dot")).toBeNull()
  })

  it("an explicit hidden wins, even an empty one", () => {
    renderWith({ v: 1, hidden: [] }, true)
    expect(headers()).toEqual(["Name", "A", "B"])
  })

  it("without the flag a missing hidden means nothing is hidden", () => {
    renderWith({ v: 1, widths: { name: 300 } }, false)
    expect(headers()).toEqual(["Name", "A", "B"])
  })
})

describe("DataTable count-only footer (hidePages)", () => {
  const plain = COLUMNS.map(({ sortValue: _s, ...c }) => c)
  const renderFooter = (onPageChange: () => void, page = 1, total = 3) =>
    render(
      <DataTable
        rows={ROWS}
        getRowId={(r) => r.id}
        columns={plain}
        selection="multi"
        selectedCount={2}
        pagination={{ page, pageSize: 1, total, onPageChange, itemLabel: { singular: "item", plural: "items" }, hidePages: true }}
      />,
    )

  it("shows the count and the selected count and no page buttons", () => {
    renderFooter(vi.fn())
    expect(screen.getByText("3 items · 2 selected")).toBeInTheDocument()
    for (const name of ["Previous", "Next", "1"]) expect(screen.queryByRole("button", { name })).toBeNull()
  })

  it("never calls onPageChange, not even to clamp a page past the end", () => {
    const onPageChange = vi.fn()
    renderFooter(onPageChange, 9)
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it("keeps the loading placeholder", () => {
    render(
      <DataTable
        rows={ROWS}
        getRowId={(r) => r.id}
        columns={plain}
        loading
        pagination={{ page: 1, pageSize: 1, total: 0, onPageChange: () => {}, itemLabel: { singular: "item", plural: "items" }, hidePages: true }}
      />,
    )
    expect(screen.getByText("—")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull()
  })
})

describe("DataTable context menu: submenus and empty menus", () => {
  const plain = COLUMNS.map(({ sortValue: _s, ...c }) => c)
  const rowOf = (name: string) => screen.getByText(name).closest("tr")!

  it("renders a submenu whose items receive the rows, with separators and destructive items", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onDelete = vi.fn()
    render(
      <DataTable
        rows={ROWS}
        getRowId={(r) => r.id}
        columns={plain}
        selection="multi"
        contextMenu={() => [
          { key: "top", label: "Top", onSelect: () => {} },
          {
            key: "sub",
            label: "More",
            items: [
              { key: "a", label: "Nested A", onSelect },
              { key: "sep", separator: true },
              { key: "d", label: "Nested delete", destructive: true, onSelect: onDelete },
            ],
          },
        ]}
      />,
    )
    fireEvent.contextMenu(rowOf("A"))
    expect(await screen.findByRole("menuitem", { name: "Top" })).toBeInTheDocument()
    await user.click(screen.getByRole("menuitem", { name: "More" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Nested A" }))
    expect(onSelect).toHaveBeenCalledWith([ROWS[1]])
    fireEvent.contextMenu(rowOf("C"))
    await user.click(await screen.findByRole("menuitem", { name: "More" }))
    const del = await screen.findByRole("menuitem", { name: "Nested delete" })
    expect(del).toHaveAttribute("data-variant", "destructive")
    fireEvent.click(del)
    expect(onDelete).toHaveBeenCalledWith([ROWS[2]])
  })

  it("a disabled submenu cannot be opened", async () => {
    const user = userEvent.setup()
    render(
      <DataTable
        rows={ROWS}
        getRowId={(r) => r.id}
        columns={plain}
        contextMenu={() => [{ key: "sub", label: "More", disabled: true, items: [{ key: "a", label: "Nested A", onSelect: () => {} }] }]}
      />,
    )
    fireEvent.contextMenu(rowOf("A"))
    const trigger = await screen.findByRole("menuitem", { name: "More" })
    expect(trigger).toHaveAttribute("data-disabled")
    await user.click(trigger)
    expect(screen.queryByRole("menuitem", { name: "Nested A" })).toBeNull()
  })

  it("opens nothing, and not the browser's menu either, when the builder returns no items", () => {
    const builder = vi.fn(() => [])
    render(<DataTable rows={ROWS} getRowId={(r) => r.id} columns={plain} selection="multi" contextMenu={builder} />)
    // fireEvent returns false when a handler called preventDefault.
    expect(fireEvent.contextMenu(rowOf("A"))).toBe(false)
    expect(builder).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("menu")).toBeNull()
  })
})

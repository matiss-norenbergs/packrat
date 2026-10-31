import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { tableLayoutsQueryKey } from "@/hooks/useTableLayout"
import type { TableLayout, TableLayouts } from "@/types/api"
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

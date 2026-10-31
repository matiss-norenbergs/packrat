import { useState } from "react"
import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { tableLayoutsQueryKey } from "@/hooks/useTableLayout"
import type { TableLayouts } from "@/types/api"
import { DataTable } from "./DataTable"
import type { ColumnDef } from "./types"

vi.mock("@/lib/api", () => ({
  fetchTableLayouts: vi.fn(),
  saveTableLayout: vi.fn(),
  deleteTableLayout: vi.fn(async () => undefined),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

interface Row {
  id: number
  name: string
}
const mk = (n: number, prefix = "Item"): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `${prefix} ${String(i + 1).padStart(2, "0")}` }))
const COLUMNS: ColumnDef<Row>[] = [
  { key: "n", header: "Name", sortValue: (r) => r.name, cell: (r) => r.name },
  { key: "x", header: "Extra", hideable: true, cell: () => "x" },
]
const LABEL = { singular: "item", plural: "items" }
const match = (r: Row, q: string) => r.name.toLowerCase().includes(q)

function withLayouts(ui: ReactNode, layouts: TableLayouts = {}) {
  const client = new QueryClient()
  client.setQueryData(tableLayoutsQueryKey, layouts)
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

const container = () => document.querySelector<HTMLElement>('[data-slot="table-container"]')!
// jsdom has no layout: scrollTop / scrollLeft are plain settable properties.
const scrollAway = () => {
  container().scrollTop = 120
  container().scrollLeft = 45
}
const top = () => container().scrollTop
const left = () => container().scrollLeft

describe("DataTable scroll reset (client mode)", () => {
  function Harness({ rows = mk(120), resetKey }: { rows?: Row[]; resetKey?: unknown }) {
    return (
      <DataTable
        rows={rows}
        getRowId={(r) => r.id}
        columns={COLUMNS}
        selection="multi"
        pageSize={50}
        itemLabel={LABEL}
        search={{ match }}
        resetKey={resetKey}
      />
    )
  }

  it("does nothing on mount", () => {
    render(<Harness />)
    expect(top()).toBe(0)
  })

  it("a page change resets scrollTop and keeps scrollLeft", () => {
    render(<Harness />)
    scrollAway()
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    expect(top()).toBe(0)
    expect(left()).toBe(45)
  })

  it("a header sort click resets scrollTop and keeps scrollLeft", () => {
    render(<Harness />)
    scrollAway()
    fireEvent.click(screen.getByRole("button", { name: "Name" }))
    expect(top()).toBe(0)
    expect(left()).toBe(45)
  })

  it("a search resets scrollTop and keeps scrollLeft", () => {
    render(<Harness />)
    scrollAway()
    fireEvent.change(screen.getByPlaceholderText("Search…"), { target: { value: "item 1" } })
    act(() => void vi.advanceTimersByTime(300))
    expect(top()).toBe(0)
    expect(left()).toBe(45)
  })

  it("a resetKey change resets scrollTop and keeps scrollLeft", () => {
    const { rerender } = render(<Harness resetKey="a" />)
    scrollAway()
    rerender(<Harness resetKey="a" />)
    expect(top()).toBe(120)
    rerender(<Harness resetKey="b" />)
    expect(top()).toBe(0)
    expect(left()).toBe(45)
  })

  it("a selection change, new rows on the same page and a hidden column do not", async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    const { rerender } = render(<Harness />)
    scrollAway()
    fireEvent.mouseDown(screen.getByText("Item 03").closest("tr")!)
    fireEvent.mouseUp(window)
    expect(top()).toBe(120)
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row 4" }))
    expect(top()).toBe(120)
    rerender(<Harness rows={mk(120, "Fresh")} />)
    expect(screen.getByText("Fresh 01")).toBeInTheDocument()
    expect(top()).toBe(120)
    expect(left()).toBe(45)
    await user.click(screen.getByRole("button", { name: "Columns" }))
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Extra" }))
    expect(screen.queryByRole("columnheader", { name: "Extra" })).toBeNull()
    expect(top()).toBe(120)
    expect(left()).toBe(45)
  })

  it("Restore and Clear (a sort change) reset scrollTop", async () => {
    vi.useRealTimers()
    render(
      withLayouts(
        <DataTable rows={mk(120)} getRowId={(r) => r.id} columns={COLUMNS} pageSize={50} itemLabel={LABEL} tableId="t" />,
        { t: { v: 1, sort: { key: "n", dir: "desc" } } },
      ),
    )
    const openLayout = () => fireEvent.click(screen.getByRole("button", { name: /Table layout/i }))
    // Restore: the user changed the sort, Restore returns to the saved one
    fireEvent.click(screen.getByRole("button", { name: "Name" })) // desc -> default
    scrollAway()
    openLayout()
    fireEvent.click(await screen.findByRole("button", { name: /^Restore/ }))
    expect(top()).toBe(0)
    expect(left()).toBe(45)
    // Clear: deletes the saved layout, the sort goes back to the default
    scrollAway()
    openLayout()
    fireEvent.click(await screen.findByRole("button", { name: "Clear saved layout" }))
    await waitFor(() => expect(top()).toBe(0))
    expect(left()).toBe(45)
  })
})

describe("DataTable scroll reset (controlled mode)", () => {
  function Controlled() {
    const [page, setPage] = useState(1)
    const [q, setQ] = useState("")
    const [n, setN] = useState(0)
    return (
      <>
        <button onClick={() => setN((v) => v + 1)}>refetch</button>
        <DataTable
          rows={mk(50, `P${page}${q}${n > 0 ? "r" : ""}`)}
          getRowId={(r) => r.id}
          columns={COLUMNS}
          search={{ onChange: setQ }}
          pagination={{ page, pageSize: 50, total: 150, onPageChange: setPage, itemLabel: LABEL }}
        />
      </>
    )
  }

  it("resets on pagination.page and on the query search.onChange reports, not on a refetch", () => {
    render(<Controlled />)
    scrollAway()
    fireEvent.click(screen.getByText("refetch"))
    expect(top()).toBe(120)
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    expect(top()).toBe(0)
    expect(left()).toBe(45)
    scrollAway()
    fireEvent.change(screen.getByPlaceholderText("Search…"), { target: { value: "abc" } })
    act(() => void vi.advanceTimersByTime(300))
    expect(top()).toBe(0)
    expect(left()).toBe(45)
  })
})

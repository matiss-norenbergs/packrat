import { useState } from "react"
import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { tableLayoutsQueryKey } from "@/hooks/useTableLayout"
import type { TableLayout, TableLayouts } from "@/types/api"
import { DataTable } from "./DataTable"
import type { DataTableProps } from "./DataTable"
import type { ColumnDef } from "./types"

const api = vi.hoisted(() => ({ fetchTableLayouts: vi.fn(), saveTableLayout: vi.fn(), deleteTableLayout: vi.fn() }))
vi.mock("@/lib/api", () => api)
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

interface Row {
  id: number
  name: string
  birthday: string
  usage: string
}
const ROWS: Row[] = [1, 2].map((i) => ({ id: i, name: `Name${i}`, birthday: `Bday${i}`, usage: `Usage${i}` }))

function columns(): ColumnDef<Row>[] {
  return [
    { key: "name", header: "Name", cell: (r) => r.name, width: 200 },
    { key: "birthday", header: "Birthday", cell: (r) => r.birthday, width: 120, hideable: true },
    { key: "usage", header: <span>Used</span>, label: "Usage", cell: (r) => r.usage, width: 100, hideable: true },
  ]
}

function renderTable(props: Partial<DataTableProps<Row, number>> = {}, saved: TableLayouts = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(tableLayoutsQueryKey, saved)
  const cols = columns()
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const ui = (p: Partial<DataTableProps<Row, number>>) => <DataTable rows={ROWS} getRowId={(r) => r.id} columns={cols} {...p} />
  const result = render(ui(props), { wrapper: Wrapper })
  return { client, cols, ...result, again: (p: Partial<DataTableProps<Row, number>> = props) => result.rerender(ui(p)) }
}

const columnsButton = () => screen.queryByRole("button", { name: "Columns" })
const layoutButton = () => screen.queryByRole("button", { name: "Table layout" })
// Read from the DOM: while a Radix menu is open everything outside it is aria-hidden.
const headers = () => Array.from(document.querySelectorAll("th")).map((h) => h.textContent)

beforeEach(() => {
  api.fetchTableLayouts.mockReset().mockResolvedValue({})
  api.saveTableLayout.mockReset().mockImplementation(async (_id: string, l: TableLayout) => l)
  api.deleteTableLayout.mockReset().mockResolvedValue(undefined)
  toast.success.mockReset()
  toast.error.mockReset()
})
afterEach(cleanup)

async function openColumns(user: ReturnType<typeof userEvent.setup>) {
  await user.click(columnsButton()!)
  return await screen.findByRole("menu")
}

describe("DataTable columns menu", () => {
  it("renders neither button when no column is hideable, with or without a tableId", () => {
    const plain = columns().map(({ hideable: _h, ...c }) => c)
    const client = new QueryClient()
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <DataTable rows={ROWS} getRowId={(r) => r.id} columns={plain} tableId="t" />
      </QueryClientProvider>,
    )
    expect(columnsButton()).toBeNull()
    expect(layoutButton()).toBeNull()
    rerender(
      <QueryClientProvider client={client}>
        <DataTable rows={ROWS} getRowId={(r) => r.id} columns={plain} />
      </QueryClientProvider>,
    )
    expect(columnsButton()).toBeNull()
  })

  it("shows only Columns without a tableId, and hiding removes header, cells and colgroup entry", async () => {
    const user = userEvent.setup()
    renderTable()
    expect(columnsButton()).toBeInTheDocument()
    expect(layoutButton()).toBeNull()
    expect(headers()).toEqual(["Name", "Birthday", "Used"])
    expect(document.querySelectorAll("col")).toHaveLength(3)

    const menu = await openColumns(user)
    expect(within(menu).getAllByRole("menuitemcheckbox").map((i) => i.textContent)).toEqual(["Birthday", "Usage"]) // label beats header; Name is not offered
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: "Birthday" }))
    expect(screen.getByRole("menu")).toBeInTheDocument() // choosing an item keeps the menu open
    expect(headers()).toEqual(["Name", "Used"])
    expect(screen.queryByText("Bday1")).toBeNull()
    expect(screen.getByText("Usage1")).toBeInTheDocument()
    expect(document.querySelectorAll("col")).toHaveLength(2)
    expect(within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: "Birthday" })).toHaveAttribute("aria-checked", "false")

    await user.click(within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: "Birthday" }))
    expect(headers()).toEqual(["Name", "Birthday", "Used"])
    expect(screen.getByText("Bday1")).toBeInTheDocument()
    expect(document.querySelectorAll("col")).toHaveLength(3)
  })

  it("fixed-layout width follows the visible columns only", async () => {
    const user = userEvent.setup()
    renderTable()
    const table = () => document.querySelector("table") as HTMLElement
    expect(table().style.minWidth).toBe("420px")
    await user.click(columnsButton()!)
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Birthday" }))
    expect(table().style.minWidth).toBe("300px")
  })

  it("hides a defaultVisible:false column initially and falls back to a string header for its label", async () => {
    const user = userEvent.setup()
    const cols: ColumnDef<Row>[] = [
      { key: "name", header: "Name", cell: (r) => r.name },
      { key: "birthday", header: "Birthday", cell: (r) => r.birthday, hideable: true, defaultVisible: false },
    ]
    render(<DataTable rows={ROWS} getRowId={(r) => r.id} columns={cols} />)
    expect(headers()).toEqual(["Name"])
    await user.click(columnsButton()!)
    const item = await screen.findByRole("menuitemcheckbox", { name: "Birthday" })
    expect(item).toHaveAttribute("aria-checked", "false")
    await user.click(item)
    expect(headers()).toEqual(["Name", "Birthday"])
  })

  it("never hides a non-hideable column, ignores unknown saved keys, and gives new columns their default", () => {
    renderTable({ tableId: "t" }, { t: { v: 1, hidden: ["name", "ghost", "usage"] } })
    expect(headers()).toEqual(["Name", "Birthday"])
    expect(screen.getByText("Name1")).toBeInTheDocument()
    // The ignored keys do not make the table look changed.
    expect(screen.queryByTestId("layout-dirty-dot")).toBeNull()
  })

  it("the selection column is not offered and stays", async () => {
    const user = userEvent.setup()
    renderTable({ selection: "multi" })
    await user.click(columnsButton()!)
    expect((await screen.findAllByRole("menuitemcheckbox")).map((i) => i.textContent)).toEqual(["Birthday", "Usage"])
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Birthday" }))
    expect(screen.getByRole("checkbox", { name: "Select all", hidden: true })).toBeInTheDocument()
  })
})

describe("DataTable toolbar order", () => {
  const order = () => Array.from(screen.getByRole("button", { name: "Columns" }).parentElement!.children).map((c) => c.textContent || c.getAttribute("aria-label") || c.querySelector("input")?.getAttribute("placeholder"))

  it("filters, search, Columns, Layout, with ml-auto on the first of the right-hand group", () => {
    renderTable({ tableId: "t", toolbar: <button>New</button>, filters: <span>filter</span>, search: { placeholder: "Find…" } })
    expect(order()).toEqual(["New", "filter", "Find…", "Columns", "Table layout"])
    expect(screen.getByText("filter").parentElement).toHaveClass("ml-auto")
    expect(columnsButton()).not.toHaveClass("ml-auto")
  })

  it("search first when there are no filters", () => {
    renderTable({ tableId: "t", toolbar: <button>New</button>, search: { placeholder: "Find…" } })
    expect(order()).toEqual(["New", "Find…", "Columns", "Table layout"])
    expect(screen.getByPlaceholderText("Find…").parentElement).toHaveClass("ml-auto")
    expect(columnsButton()).not.toHaveClass("ml-auto")
  })

  it("the buttons sit at the right end when there is no search and no filters", () => {
    renderTable({ tableId: "t", toolbar: <button>New</button> })
    expect(order()).toEqual(["New", "Columns", "Table layout"])
    expect(columnsButton()).toHaveClass("ml-auto")
    expect(layoutButton()).not.toHaveClass("ml-auto")
  })

  it("Columns alone gets ml-auto without a tableId, and a table without a toolbar gets one for the buttons", () => {
    renderTable()
    expect(columnsButton()).toHaveClass("ml-auto")
    expect(layoutButton()).toBeNull()
  })

  it("a table without hideable columns keeps the old classes", () => {
    render(<DataTable rows={ROWS} getRowId={(r) => r.id} columns={[{ key: "n", header: "Name", cell: (r: Row) => r.name }]} search={{ placeholder: "Find…" }} />)
    expect(screen.getByPlaceholderText("Find…").parentElement).toHaveClass("ml-auto")
    expect(screen.queryAllByRole("button", { name: /Columns|Table layout/ })).toHaveLength(0)
  })
})

describe("DataTable layout popover", () => {
  async function open(user: ReturnType<typeof userEvent.setup>) {
    await user.click(layoutButton()!)
    return await screen.findByRole("dialog")
  }
  const toggleBirthday = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(columnsButton()!)
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Birthday" }))
    await user.keyboard("{Escape}")
  }

  it("with nothing changed and nothing saved: no dot, everything disabled, Restore defaults", async () => {
    const user = userEvent.setup()
    renderTable({ tableId: "t" })
    expect(screen.queryByTestId("layout-dirty-dot")).toBeNull()
    const pop = await open(user)
    expect(within(pop).getByRole("button", { name: "Save" })).toBeDisabled()
    expect(within(pop).getByRole("button", { name: "Restore defaults" })).toBeDisabled()
    expect(within(pop).getByRole("button", { name: "Clear saved layout" })).toBeDisabled()
  })

  it("after a change: dot, Save and Restore enabled, Clear still disabled", async () => {
    const user = userEvent.setup()
    renderTable({ tableId: "t" })
    await toggleBirthday(user)
    expect(screen.getByTestId("layout-dirty-dot")).toBeInTheDocument()
    const pop = await open(user)
    expect(within(pop).getByRole("button", { name: "Save" })).toBeEnabled()
    expect(within(pop).getByRole("button", { name: "Restore defaults" })).toBeEnabled()
    expect(within(pop).getByRole("button", { name: "Clear saved layout" })).toBeDisabled()
  })

  it("with a saved layout: Restore saved, Clear enabled, and the saved columns applied from the first render", async () => {
    const user = userEvent.setup()
    renderTable({ tableId: "t" }, { t: { v: 1, hidden: ["usage"] } })
    expect(headers()).toEqual(["Name", "Birthday"])
    expect(screen.queryByTestId("layout-dirty-dot")).toBeNull()
    const pop = await open(user)
    expect(within(pop).getByRole("button", { name: "Save" })).toBeDisabled()
    expect(within(pop).getByRole("button", { name: "Restore saved" })).toBeDisabled()
    expect(within(pop).getByRole("button", { name: "Clear saved layout" })).toBeEnabled()
  })

  it("Save sends the working layout, closes the popover and toasts when the server answers", async () => {
    const user = userEvent.setup()
    renderTable({ tableId: "t" })
    await toggleBirthday(user)
    await user.click(within(await open(user)).getByRole("button", { name: "Save" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(api.saveTableLayout).toHaveBeenCalledWith("t", { v: 1, hidden: ["birthday"] })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Layout saved"))
    await waitFor(() => expect(screen.queryByTestId("layout-dirty-dot")).toBeNull())
    expect(headers()).toEqual(["Name", "Used"])
  })

  it("Restore returns to the baseline without a request or a toast", async () => {
    const user = userEvent.setup()
    renderTable({ tableId: "t" }, { t: { v: 1, hidden: ["usage"] } })
    await toggleBirthday(user)
    expect(headers()).toEqual(["Name"])
    await user.click(within(await open(user)).getByRole("button", { name: "Restore saved" }))
    expect(headers()).toEqual(["Name", "Birthday"])
    expect(api.saveTableLayout).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.queryByTestId("layout-dirty-dot")).toBeNull()
  })

  it("Clear deletes the saved layout and applies the defaults", async () => {
    const user = userEvent.setup()
    renderTable({ tableId: "t" }, { t: { v: 1, hidden: ["usage"] } })
    expect(headers()).toEqual(["Name", "Birthday"])
    await user.click(within(await open(user)).getByRole("button", { name: "Clear saved layout" }))
    expect(api.deleteTableLayout).toHaveBeenCalledWith("t")
    await waitFor(() => expect(headers()).toEqual(["Name", "Birthday", "Used"]))
    expect(toast.success).toHaveBeenCalledWith("Layout cleared")
  })

  it("a new mount starts from the baseline again (changes are never kept automatically)", async () => {
    const user = userEvent.setup()
    const first = renderTable({ tableId: "t" })
    await toggleBirthday(user)
    expect(headers()).toEqual(["Name", "Used"])
    first.unmount()
    renderTable({ tableId: "t" })
    expect(headers()).toEqual(["Name", "Birthday", "Used"])
  })
})

describe("DataTable while the saved layouts are still loading", () => {
  it("shows its loading state, not the default columns, until the layouts arrive, then applies them", async () => {
    let resolve!: (v: TableLayouts) => void
    api.fetchTableLayouts.mockReturnValue(new Promise<TableLayouts>((r) => (resolve = r)))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <DataTable rows={ROWS} getRowId={(r) => r.id} columns={columns()} tableId="t" pageSize={50} itemLabel={{ singular: "row", plural: "rows" }} />
      </QueryClientProvider>,
    )
    expect(headers()).toEqual([])
    expect(screen.queryByText("Bday1")).toBeNull()
    expect(screen.getByText("—")).toBeInTheDocument() // the footer is there, as a placeholder
    resolve({ t: { v: 1, hidden: ["usage"] } })
    await waitFor(() => expect(headers()).toEqual(["Name", "Birthday"]))
    expect(screen.getByText("2 rows")).toBeInTheDocument()
  })

  it.each([
    ["the endpoint answers 404", new Error("Not found")],
    ["the network fails", new TypeError("Failed to fetch")],
  ])("falls back to the defaults after one request when %s, without waiting for retries", async (_name, failure) => {
    api.fetchTableLayouts.mockRejectedValue(failure)
    // The app's QueryClient defaults (3 retries with backoff), not the retry-free one the other tests use.
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <DataTable
          rows={ROWS}
          getRowId={(r) => r.id}
          columns={columns()}
          tableId="t"
          pageSize={50}
          itemLabel={{ singular: "row", plural: "rows" }}
        />
      </QueryClientProvider>,
    )
    // Retries would take about 7 s; 1 s is plenty for the single failed request.
    await waitFor(() => expect(headers()).toEqual(["Name", "Birthday", "Used"]), { timeout: 1000 })
    expect(screen.getByText("2 rows")).toBeInTheDocument() // footer is not stuck on the placeholder
    expect(document.querySelector("[data-slot=skeleton]")).toBeNull()
    expect(api.fetchTableLayouts).toHaveBeenCalledTimes(1)
  })

  it("adopts a later successful fetch after a failure when the user has not edited", async () => {
    api.fetchTableLayouts.mockRejectedValueOnce(new Error("Not found"))
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <DataTable rows={ROWS} getRowId={(r) => r.id} columns={columns()} tableId="t" />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(headers()).toEqual(["Name", "Birthday", "Used"]), { timeout: 1000 })
    api.fetchTableLayouts.mockResolvedValue({ t: { v: 1, hidden: ["usage"] } })
    await act(() => client.refetchQueries({ queryKey: tableLayoutsQueryKey }))
    await waitFor(() => expect(headers()).toEqual(["Name", "Birthday"]))
  })
})

describe("DataTable controlled layout", () => {
  function Controlled({ initial }: { initial: TableLayout }) {
    const [layout, setLayout] = useState(initial)
    return (
      <QueryClientProvider client={new QueryClient()}>
        <DataTable rows={ROWS} getRowId={(r) => r.id} columns={cols} layout={layout} onLayoutChange={setLayout} />
        <output data-testid="layout">{JSON.stringify(layout)}</output>
      </QueryClientProvider>
    )
  }
  const cols = columns()

  it("renders from the layout prop and reports edits, carrying sort and widths through", async () => {
    const user = userEvent.setup()
    render(<Controlled initial={{ v: 1, hidden: ["usage"], sort: { key: "name", dir: "desc" }, widths: { name: 250 } }} />)
    expect(headers()).toEqual(["Name", "Birthday"])
    await user.click(columnsButton()!)
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Birthday" }))
    expect(headers()).toEqual(["Name"])
    expect(JSON.parse(screen.getByTestId("layout").textContent!)).toEqual({
      v: 1,
      hidden: ["usage", "birthday"],
      sort: { key: "name", dir: "desc" },
      widths: { name: 250 },
    })
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Usage" }))
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Birthday" }))
    expect(JSON.parse(screen.getByTestId("layout").textContent!)).toEqual({ v: 1, sort: { key: "name", dir: "desc" }, widths: { name: 250 } })
  })

  it("with a tableId the saved-layout controls work on the page's working layout", async () => {
    const user = userEvent.setup()
    const onLayoutChange = vi.fn()
    const client = new QueryClient()
    client.setQueryData(tableLayoutsQueryKey, { t: { v: 1, hidden: ["usage"] } })
    render(
      <QueryClientProvider client={client}>
        <DataTable rows={ROWS} getRowId={(r) => r.id} columns={cols} tableId="t" layout={{ v: 1 }} onLayoutChange={onLayoutChange} />
      </QueryClientProvider>,
    )
    expect(headers()).toEqual(["Name", "Birthday", "Used"])
    expect(screen.getByTestId("layout-dirty-dot")).toBeInTheDocument() // the page's working layout differs from the saved one
    await user.click(layoutButton()!)
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore saved" }))
    expect(onLayoutChange).toHaveBeenCalledWith({ v: 1, hidden: ["usage"] })
  })
})

describe("DataTable row memoization with hideable columns", () => {
  it("re-renders the cells once per toggle and not at all on an unrelated render", async () => {
    const user = userEvent.setup()
    const renders = { name: 0, usage: 0 }
    const cols: ColumnDef<Row>[] = [
      { key: "name", header: "Name", cell: (r) => (renders.name++, r.name) },
      { key: "birthday", header: "Birthday", cell: (r) => r.birthday, hideable: true },
      { key: "usage", header: "Usage", cell: (r) => (renders.usage++, r.usage), hideable: true },
    ]
    const client = new QueryClient()
    const ui = (extra?: ReactNode) => (
      <QueryClientProvider client={client}>
        <DataTable rows={ROWS} getRowId={(r) => r.id} columns={cols} tableId="t" />
        {extra}
      </QueryClientProvider>
    )
    client.setQueryData(tableLayoutsQueryKey, {})
    const { rerender } = render(ui())
    expect(renders).toEqual({ name: 2, usage: 2 })
    rerender(ui(<i />))
    expect(renders).toEqual({ name: 2, usage: 2 })
    await user.click(columnsButton()!)
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Birthday" }))
    expect(renders).toEqual({ name: 4, usage: 4 }) // one re-render of the two rows
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Birthday" }))
    expect(renders).toEqual({ name: 6, usage: 6 })
  })

  it("a row selection change still re-renders only the rows whose selected flag flipped", async () => {
    const user = userEvent.setup()
    const renders = { name: 0 }
    const cols: ColumnDef<Row>[] = [
      { key: "name", header: "Name", cell: (r) => (renders.name++, r.name) },
      { key: "usage", header: "Usage", cell: (r) => r.usage, hideable: true },
    ]
    render(<DataTable rows={ROWS} getRowId={(r) => r.id} columns={cols} selection="multi" />)
    expect(renders.name).toBe(2)
    await user.click(screen.getByRole("checkbox", { name: "Select row 1" }))
    expect(renders.name).toBe(3)
  })
})

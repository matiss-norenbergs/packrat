import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { tableLayoutsQueryKey } from "@/hooks/useTableLayout"
import type { TableLayout, TableLayouts } from "@/types/api"
import { DataTable } from "./DataTable"
import type { DataTableProps } from "./DataTable"
import type { ColumnDef } from "./types"

const api = vi.hoisted(() => ({ fetchTableLayouts: vi.fn(), saveTableLayout: vi.fn(), deleteTableLayout: vi.fn() }))
vi.mock("@/lib/api", () => api)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// jsdom has no PointerEvent: a MouseEvent that also carries a pointerId (fireEvent copies the init onto it).
beforeAll(() => {
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number
      pointerType: string
      constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 1
        this.pointerType = init.pointerType ?? "mouse"
      }
    }
    window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent
  }
})

interface Row {
  id: number
  name: string
  size: string
}
const ROWS: Row[] = [1, 2].map((i) => ({ id: i, name: `Name${i}`, size: `Size${i}` }))

const renders = { name: 0 }
function columns(): ColumnDef<Row>[] {
  return [
    { key: "name", header: "Name", cell: (r) => (renders.name++, r.name), width: 200, sortValue: (r) => r.name },
    { key: "size", header: "Size", cell: (r) => r.size, width: 100, type: "number", minWidth: 60 },
  ]
}

function renderTable(props: Partial<DataTableProps<Row, number>> = {}, saved: TableLayouts = {}, cols = columns()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(tableLayoutsQueryKey, saved)
  return render(
    <QueryClientProvider client={client}>
      <DataTable rows={ROWS} getRowId={(r) => r.id} columns={cols} tableId="t" {...props} />
    </QueryClientProvider>,
  )
}

const handle = (name: string) => screen.queryByRole("separator", { name: `Resize ${name} column` })
const colWidths = () => Array.from(document.querySelectorAll("col")).map((c) => (c as HTMLElement).style.width)
const minWidth = () => (document.querySelector("table") as HTMLElement).style.minWidth
const dirtyDot = () => screen.queryByTestId("layout-dirty-dot")
const down = (el: Element, x: number) => fireEvent.pointerDown(el, { clientX: x, pointerId: 1, button: 0 })
const move = (el: Element, x: number) => fireEvent.pointerMove(el, { clientX: x, pointerId: 1 })
const up = (el: Element, x: number) => fireEvent.pointerUp(el, { clientX: x, pointerId: 1 })
function drag(el: Element, from: number, to: number) {
  down(el, from)
  move(el, to)
  up(el, to)
}

beforeEach(() => {
  renders.name = 0
  api.fetchTableLayouts.mockReset().mockResolvedValue({})
  api.saveTableLayout.mockReset().mockImplementation(async (_id: string, l: TableLayout) => l)
  api.deleteTableLayout.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  document.body.style.cssText = ""
})

describe("column resize handles", () => {
  it("gets a vertical, unfocusable separator named after the column on every resizable column", () => {
    renderTable()
    const h = handle("Name")!
    expect(h).toHaveAttribute("aria-orientation", "vertical")
    expect(h).not.toHaveAttribute("tabindex")
    expect(h).toHaveClass("cursor-col-resize", "touch-none")
    expect(handle("Size")).toBeInTheDocument()
    expect(h.parentElement!.tagName).toBe("TH")
  })

  it("is a sibling of the sort button, not inside it", () => {
    renderTable()
    const th = handle("Name")!.parentElement!
    expect(th.querySelector("button")!.contains(handle("Name"))).toBe(false)
  })

  it("is missing on a table without a tableId", () => {
    renderTable({ tableId: undefined })
    expect(screen.queryAllByRole("separator")).toHaveLength(0)
  })

  it("is missing on the selection column, flex, icon, switch and resizable:false columns", () => {
    const cols: ColumnDef<Row>[] = [
      { key: "a", header: "A", cell: (r) => r.name },
      { key: "flex", header: "Flex", cell: (r) => r.name, flex: true },
      { key: "icon", header: "Icon", cell: (r) => r.name, type: "icon" },
      { key: "sw", header: "Sw", cell: (r) => r.name, type: "switch" },
      { key: "fixed", header: "Fixed", cell: (r) => r.name, resizable: false },
    ]
    renderTable({ selection: "multi" }, {}, cols)
    expect(screen.getAllByRole("separator").map((s) => s.getAttribute("aria-label"))).toEqual(["Resize A column"])
  })

  it("resizable: true forces a handle on a flex or icon column", () => {
    const cols: ColumnDef<Row>[] = [
      { key: "flex", header: "Flex", cell: (r) => r.name, flex: true, resizable: true },
      { key: "icon", header: "Icon", cell: (r) => r.name, type: "icon", resizable: true },
    ]
    renderTable({}, {}, cols)
    expect(handle("Flex")).toBeInTheDocument()
    expect(handle("Icon")).toBeInTheDocument()
  })

  it("is named by the column's label when the header is not a string", () => {
    const cols: ColumnDef<Row>[] = [{ key: "a", header: <span>Aa</span>, label: "Alpha", cell: (r) => r.name }]
    renderTable({}, {}, cols)
    expect(handle("Alpha")).toBeInTheDocument()
  })
})

describe("column resize drag", () => {
  it("changes the colgroup width and the table min-width live, and commits only on release", () => {
    renderTable()
    const h = handle("Name")!
    expect(colWidths()).toEqual(["200px", "100px", ""])
    expect(minWidth()).toBe("300px")
    down(h, 500)
    move(h, 560)
    expect(colWidths()).toEqual(["260px", "100px", ""])
    expect(minWidth()).toBe("360px")
    expect(dirtyDot()).toBeNull() // still a draft of the drag, not of the layout
    move(h, 530)
    expect(colWidths()).toEqual(["230px", "100px", ""])
    up(h, 530)
    expect(colWidths()).toEqual(["230px", "100px", ""])
    expect(minWidth()).toBe("330px")
    expect(dirtyDot()).toBeInTheDocument()
  })

  it("does not commit a plain click", () => {
    renderTable()
    const h = handle("Name")!
    down(h, 500)
    up(h, 500)
    expect(dirtyDot()).toBeNull()
  })

  it("clamps at the column's minWidth (default 48) and at 2000", () => {
    renderTable()
    const size = handle("Size")!
    down(size, 500)
    move(size, 0)
    expect(colWidths()[1]).toBe("60px")
    move(size, 99999)
    expect(colWidths()[1]).toBe("2000px")
    up(size, 99999)
    expect(colWidths()[1]).toBe("2000px")
    const name = handle("Name")!
    drag(name, 500, 0)
    expect(colWidths()[0]).toBe("48px")
  })

  it("a width equal to the default is dropped: no dirty dot", () => {
    renderTable()
    const h = handle("Name")!
    drag(h, 500, 560)
    expect(dirtyDot()).toBeInTheDocument()
    drag(h, 500, 440) // 260 -> 200 again
    expect(colWidths()[0]).toBe("200px")
    expect(dirtyDot()).toBeNull()
  })

  it("sets the body cursor and no-select while dragging and restores them on release", () => {
    document.body.style.cursor = "wait"
    renderTable()
    const h = handle("Name")!
    down(h, 10)
    expect(document.body.style.cursor).toBe("col-resize")
    expect(document.body.style.userSelect).toBe("none")
    up(h, 10)
    expect(document.body.style.cursor).toBe("wait")
    expect(document.body.style.userSelect).toBe("")
  })

  it("pointercancel restores the body and keeps the old width", () => {
    renderTable()
    const h = handle("Name")!
    down(h, 10)
    move(h, 90)
    expect(colWidths()[0]).toBe("280px")
    fireEvent.pointerCancel(h, { pointerId: 1 })
    expect(colWidths()[0]).toBe("200px")
    expect(document.body.style.cursor).toBe("")
    expect(document.body.style.userSelect).toBe("")
    expect(dirtyDot()).toBeNull()
  })

  it("unmounting mid-drag restores the body", () => {
    const { unmount } = renderTable()
    down(handle("Name")!, 10)
    expect(document.body.style.cursor).toBe("col-resize")
    unmount()
    expect(document.body.style.cursor).toBe("")
    expect(document.body.style.userSelect).toBe("")
  })

  it("ignores a secondary mouse button", () => {
    renderTable()
    fireEvent.pointerDown(handle("Name")!, { clientX: 10, pointerId: 1, button: 2, pointerType: "mouse" })
    expect(document.body.style.cursor).toBe("")
  })

  it("prevents the default of the press (no text selection) and never sorts", async () => {
    renderTable()
    const h = handle("Name")!
    expect(fireEvent.pointerDown(h, { clientX: 10, pointerId: 1, button: 0 })).toBe(false) // preventDefault was called
    up(h, 10)
    fireEvent.click(h)
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "none")
    drag(h, 10, 60)
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "none")
    // The sort button next to it still works.
    await userEvent.setup().click(screen.getByRole("button", { name: "Name" }))
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "ascending")
  })

  it("does not re-render the rows while dragging", () => {
    renderTable()
    const before = renders.name
    const h = handle("Name")!
    down(h, 100)
    for (let x = 110; x <= 200; x += 10) move(h, x)
    expect(renders.name).toBe(before)
    up(h, 200)
  })
})

describe("column widths in the saved layout", () => {
  async function openLayout(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Table layout" }))
    return await screen.findByRole("dialog")
  }

  it("Save sends the width override in the PUT body", async () => {
    const user = userEvent.setup()
    renderTable()
    drag(handle("Name")!, 100, 180)
    const dialog = await openLayout(user)
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }))
    expect(api.saveTableLayout).toHaveBeenCalledWith("t", { v: 1, widths: { name: 280 } })
    expect(dirtyDot()).toBeNull()
  })

  it("Restore returns to the saved widths and Clear to the defaults", async () => {
    const user = userEvent.setup()
    renderTable({}, { t: { v: 1, widths: { name: 250 } } })
    expect(colWidths()[0]).toBe("250px")
    drag(handle("Name")!, 100, 160)
    expect(colWidths()[0]).toBe("310px")
    let dialog = await openLayout(user)
    await user.click(within(dialog).getByRole("button", { name: "Restore saved" }))
    expect(colWidths()[0]).toBe("250px")
    expect(dirtyDot()).toBeNull()

    drag(handle("Name")!, 100, 160)
    await user.keyboard("{Escape}")
    dialog = await openLayout(user)
    await user.click(within(dialog).getByRole("button", { name: /Clear/ }))
    expect(api.deleteTableLayout).toHaveBeenCalledWith("t")
    await vi.waitFor(() => expect(colWidths()[0]).toBe("200px"))
  })

  it("keeps the width of a hidden column", async () => {
    const user = userEvent.setup()
    const cols = columns().map((c) => (c.key === "size" ? { ...c, hideable: true } : c))
    renderTable({}, {}, cols)
    drag(handle("Size")!, 100, 140)
    await user.click(screen.getByRole("button", { name: "Columns" }))
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Size" }))
    expect(colWidths()).toEqual(["200px", ""])
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Size" }))
    expect(colWidths()).toEqual(["200px", "140px", ""])
  })

  it("combines with a sort and the saved layout in one PUT", async () => {
    const user = userEvent.setup()
    renderTable()
    await user.click(screen.getByRole("button", { name: "Name" }))
    drag(handle("Size")!, 100, 130)
    const dialog = await openLayout(user)
    await user.click(within(dialog).getByRole("button", { name: /^Save/ }))
    expect(api.saveTableLayout).toHaveBeenCalledWith("t", { v: 1, sort: { key: "name", dir: "asc" }, widths: { size: 130 } })
  })
})

describe("column resize in controlled-layout mode", () => {
  it("reports the committed widths through onLayoutChange and renders from the layout prop", () => {
    const seen: TableLayout[] = []
    function Controlled() {
      const [layout, setLayout] = useState<TableLayout>({ v: 1, hidden: [], widths: { size: 150 } })
      return (
        <DataTable
          rows={ROWS}
          getRowId={(r) => r.id}
          columns={cols}
          tableId="t"
          layout={layout}
          onLayoutChange={(l) => {
            seen.push(l)
            setLayout(l)
          }}
        />
      )
    }
    const cols = columns()
    const client = new QueryClient()
    client.setQueryData(tableLayoutsQueryKey, {})
    render(
      <QueryClientProvider client={client}>
        <Controlled />
      </QueryClientProvider>,
    )
    expect(colWidths()).toEqual(["200px", "150px", ""])
    const h = handle("Name")!
    down(h, 100)
    move(h, 150)
    expect(seen).toHaveLength(0) // nothing is reported before release
    up(h, 150)
    expect(seen.at(-1)).toMatchObject({ widths: { name: 250, size: 150 } })
    expect(colWidths()).toEqual(["250px", "150px", ""])
  })

  it("drops a dragged width that equals the default from the reported layout", () => {
    const onLayoutChange = vi.fn()
    const client = new QueryClient()
    client.setQueryData(tableLayoutsQueryKey, {})
    render(
      <QueryClientProvider client={client}>
        <DataTable
          rows={ROWS}
          getRowId={(r) => r.id}
          columns={columns()}
          tableId="t"
          layout={{ v: 1, widths: { name: 250 } }}
          onLayoutChange={onLayoutChange}
        />
      </QueryClientProvider>,
    )
    drag(handle("Name")!, 100, 50) // 250 -> 200
    expect(onLayoutChange).toHaveBeenLastCalledWith({ v: 1 })
  })
})

describe("column resize does not disturb the rest", () => {
  it("rows can still be selected after a resize", async () => {
    const user = userEvent.setup()
    renderTable({ selection: "multi" })
    drag(handle("Name")!, 100, 160)
    await user.click(screen.getByRole("checkbox", { name: "Select row 1" }))
    expect(screen.getByRole("checkbox", { name: "Select row 1" })).toBeChecked()
  })
})

import { useState } from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useIdSelection } from "@/hooks/useIdSelection"
import { DataTable } from "./DataTable"
import type { ColumnDef } from "./types"
import type { SelectionMode } from "./useTableSelection"

afterEach(cleanup)

interface Row {
  id: number
  name: string
}
// C and D are not selectable.
const ROWS: Row[] = ["A", "B", "C", "D", "E", "F"].map((name, i) => ({ id: i + 1, name }))
const LOCKED = new Set([3, 4])
const isRowSelectable = (r: Row) => !LOCKED.has(r.id)

function Harness({
  mode,
  onRowClick,
  contextMenu,
  rows = ROWS,
}: {
  mode: SelectionMode
  onRowClick?: (r: Row) => void
  contextMenu?: (rows: Row[]) => { key: string; label: string; onSelect: (rows: Row[]) => void }[]
  rows?: Row[]
}) {
  const selection = useIdSelection<number>()
  return (
    <>
      <output data-testid="sel">{Array.from(selection.selected).sort().join(",")}</output>
      <DataTable
        rows={rows}
        getRowId={(r) => r.id}
        columns={[{ key: "n", header: "Name", cell: (r) => r.name }]}
        selection={mode}
        selectionState={selection}
        getRowLabel={(r) => `Select ${r.name}`}
        isRowSelectable={isRowSelectable}
        onRowClick={onRowClick}
        contextMenu={contextMenu}
        pageSize={50}
        itemLabel={{ singular: "row", plural: "rows" }}
        toolbar={({ selectedRows }) => <output data-testid="slot">{selectedRows.map((r) => r.name).join(",")}</output>}
      />
    </>
  )
}

const sel = () => screen.getByTestId("sel").textContent
const row = (name: string) => screen.getByText(name).closest("tr")!
const press = (name: string, init?: object) => {
  fireEvent.mouseDown(row(name), init)
  fireEvent.mouseUp(window)
}

describe("DataTable isRowSelectable: multi", () => {
  it("disables the checkbox of an unselectable row and no other", () => {
    render(<Harness mode="multi" />)
    expect(screen.getByRole("checkbox", { name: "Select C" })).toBeDisabled()
    expect(screen.getByRole("checkbox", { name: "Select D" })).toBeDisabled()
    expect(screen.getByRole("checkbox", { name: "Select A" })).toBeEnabled()
  })

  it("a plain click and a ctrl/cmd click never select it", () => {
    render(<Harness mode="multi" />)
    press("A")
    press("C")
    expect(sel()).toBe("1")
    press("C", { ctrlKey: true })
    press("D", { metaKey: true })
    expect(sel()).toBe("1")
    press("B", { ctrlKey: true })
    expect(sel()).toBe("1,2")
  })

  it("a click on the disabled checkbox selects nothing", async () => {
    const user = userEvent.setup()
    render(<Harness mode="multi" />)
    await user.click(screen.getByRole("checkbox", { name: "Select C" }))
    expect(sel()).toBe("")
  })

  it("a shift range across unselectable rows skips them", () => {
    render(<Harness mode="multi" />)
    press("B")
    press("E", { shiftKey: true })
    expect(sel()).toBe("2,5")
    press("F", { shiftKey: true })
    expect(sel()).toBe("2,5,6")
    press("A", { shiftKey: true })
    expect(sel()).toBe("1,2")
  })

  it("a shift click on an unselectable row does nothing", () => {
    render(<Harness mode="multi" />)
    press("A")
    press("C", { shiftKey: true })
    expect(sel()).toBe("1")
  })

  it("a drag across a mix selects the selectable rows and carries on past the others", () => {
    render(<Harness mode="multi" />)
    fireEvent.mouseDown(row("A"))
    fireEvent.mouseEnter(row("B"))
    expect(sel()).toBe("1,2")
    fireEvent.mouseEnter(row("C"))
    fireEvent.mouseEnter(row("D"))
    expect(sel()).toBe("1,2")
    fireEvent.mouseEnter(row("E"))
    expect(sel()).toBe("1,2,5")
    fireEvent.mouseEnter(row("F"))
    fireEvent.mouseUp(window)
    expect(sel()).toBe("1,2,5,6")
  })

  it("a drag cannot start on an unselectable row", () => {
    render(<Harness mode="multi" />)
    fireEvent.mouseDown(row("C"))
    fireEvent.mouseEnter(row("E"))
    fireEvent.mouseUp(window)
    expect(sel()).toBe("")
  })

  it("select all takes the selectable rows only and the header checkbox follows", async () => {
    const user = userEvent.setup()
    render(<Harness mode="multi" />)
    const all = screen.getByRole("checkbox", { name: "Select all" })
    await user.click(all)
    expect(sel()).toBe("1,2,5,6")
    expect(all).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Select C" })).not.toBeChecked()
    await user.click(all)
    expect(sel()).toBe("")
  })

  it("the header is indeterminate while some selectable rows are selected, and not checked for an empty selectable set", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness mode="multi" />)
    press("A")
    expect(screen.getByRole("checkbox", { name: "Select all" })).toHaveAttribute("aria-checked", "mixed")
    await user.click(screen.getByRole("checkbox", { name: "Select B" }))
    await user.click(screen.getByRole("checkbox", { name: "Select E" }))
    await user.click(screen.getByRole("checkbox", { name: "Select F" }))
    expect(screen.getByRole("checkbox", { name: "Select all" })).toBeChecked()
    rerender(<Harness mode="multi" rows={ROWS.filter((r) => LOCKED.has(r.id))} />)
    expect(screen.getByRole("checkbox", { name: "Select all" })).not.toBeChecked()
  })

  it("the footer and the toolbar slot count the selectable selected rows only", async () => {
    const user = userEvent.setup()
    function Stale() {
      const selection = useIdSelection<number>()
      return (
        <>
          <button onClick={() => selection.selectAll([1, 3, 4])}>stale</button>
          <DataTable
            rows={ROWS}
            getRowId={(r) => r.id}
            columns={[{ key: "n", header: "Name", cell: (r) => r.name }]}
            selection="multi"
            selectionState={selection}
            isRowSelectable={isRowSelectable}
            pageSize={50}
            itemLabel={{ singular: "row", plural: "rows" }}
            toolbar={({ selectedRows }) => <output data-testid="slot">{selectedRows.map((r) => r.name).join(",")}</output>}
          />
        </>
      )
    }
    render(<Stale />)
    await user.click(screen.getByText("stale"))
    expect(screen.getByText(/6 rows/)).toHaveTextContent("6 rows · 1 selected")
    expect(screen.getByTestId("slot")).toHaveTextContent("A")
    expect(screen.getByTestId("slot").textContent).toBe("A")
    // A selected but unselectable row is not drawn as selected.
    expect(row("C")).toHaveAttribute("aria-selected", "false")
  })

  it("onRowClick and onRowDoubleClick still fire for it", () => {
    const onRowClick = vi.fn()
    render(<Harness mode="multi" onRowClick={onRowClick} />)
    fireEvent.click(row("C"))
    expect(onRowClick).toHaveBeenCalledTimes(1)
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ name: "C" })
  })

  it("a right-click leaves the selection alone and the menu acts on that row alone", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Harness mode="multi" contextMenu={() => [{ key: "x", label: "Do it", onSelect }]} />)
    press("A")
    press("B", { ctrlKey: true })
    await user.pointer({ keys: "[MouseRight]", target: row("C") })
    expect(sel()).toBe("1,2")
    await user.click(await screen.findByRole("menuitem", { name: "Do it" }))
    expect(onSelect.mock.calls[0][0].map((r: Row) => r.name)).toEqual(["C"])
  })

  it("a right-click on a selected row still acts on the selected rows", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Harness mode="multi" contextMenu={() => [{ key: "x", label: "Do it", onSelect }]} />)
    press("A")
    press("B", { ctrlKey: true })
    await user.pointer({ keys: "[MouseRight]", target: row("B") })
    await user.click(await screen.findByRole("menuitem", { name: "Do it" }))
    expect(onSelect.mock.calls[0][0].map((r: Row) => r.name)).toEqual(["A", "B"])
  })
})

describe("DataTable isRowSelectable: single", () => {
  it("disables the radio and a click does not select the row", () => {
    render(<Harness mode="single" />)
    expect(screen.getByRole("radio", { name: "Select C" })).toBeDisabled()
    expect(screen.getByRole("radio", { name: "Select B" })).toBeEnabled()
    press("C")
    expect(sel()).toBe("")
    press("B")
    expect(sel()).toBe("2")
    press("D")
    expect(sel()).toBe("2")
  })

  it("onRowClick still fires for it", () => {
    const onRowClick = vi.fn()
    render(<Harness mode="single" onRowClick={onRowClick} />)
    fireEvent.click(row("D"))
    expect(onRowClick).toHaveBeenCalledTimes(1)
  })

  it("a right-click leaves the selection alone", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Harness mode="single" contextMenu={() => [{ key: "x", label: "Do it", onSelect }]} />)
    press("A")
    await user.pointer({ keys: "[MouseRight]", target: row("D") })
    expect(sel()).toBe("1")
    await user.click(await screen.findByRole("menuitem", { name: "Do it" }))
    expect(onSelect.mock.calls[0][0].map((r: Row) => r.name)).toEqual(["D"])
  })
})

describe("DataTable isRowSelectable: no predicate", () => {
  it("every row stays selectable", () => {
    render(
      <DataTable
        rows={ROWS}
        getRowId={(r) => r.id}
        columns={[{ key: "n", header: "Name", cell: (r) => r.name }]}
        selection="multi"
        getRowLabel={(r) => `Select ${r.name}`}
      />,
    )
    for (const r of screen.getAllByRole("checkbox")) expect(r).toBeEnabled()
    expect(within(screen.getAllByRole("row")[0]).getByRole("checkbox", { name: "Select all" })).toBeEnabled()
  })
})

describe("DataTable isRowSelectable: memoized rows", () => {
  let renders: Record<string, number> = {}
  const spyColumns: ColumnDef<Row>[] = [
    {
      key: "n",
      header: "Name",
      cell: (r) => {
        renders[r.name] = (renders[r.name] ?? 0) + 1
        return r.name
      },
    },
  ]
  const total = () => Object.values(renders).reduce((a, b) => a + b, 0)

  function Memo() {
    const selection = useIdSelection<number>()
    const [n, setN] = useState(0)
    return (
      <>
        <button onClick={() => setN((v) => v + 1)}>bump {n}</button>
        <DataTable
          rows={ROWS}
          getRowId={(r) => r.id}
          columns={spyColumns}
          selection="multi"
          selectionState={selection}
          // an inline predicate on purpose: only its result per row (a primitive) reaches the rows
          isRowSelectable={(r) => !LOCKED.has(r.id)}
          getRowLabel={(r) => `Select ${r.name}`}
        />
      </>
    )
  }

  it("unrelated page state re-renders no row, and a selection change only the rows that changed", () => {
    render(<Memo />)
    renders = {}
    fireEvent.click(screen.getByText(/^bump/))
    expect(total()).toBe(0)
    fireEvent.mouseDown(row("B"))
    fireEvent.mouseUp(window)
    expect(renders).toEqual({ B: 1 })
    renders = {}
    fireEvent.mouseDown(row("E"), { shiftKey: true })
    expect(renders).toEqual({ E: 1 }) // the rows between stay as they were
  })
})

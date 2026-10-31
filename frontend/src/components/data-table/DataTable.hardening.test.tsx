import { useState } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createPortal } from "react-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useIdSelection } from "@/hooks/useIdSelection"
import { DataTable } from "./DataTable"
import type { ColumnDef, ContextMenuItemDef } from "./types"

afterEach(cleanup)

interface Row {
  id: number
  name: string
}
const ROWS: Row[] = ["A", "B", "C", "D", "E"].map((name, i) => ({ id: i + 1, name }))
const getRowId = (r: Row) => r.id
const nameCol: ColumnDef<Row> = { key: "n", header: "Name", cell: (r) => r.name }

const row = (name: string) => screen.getByText(name).closest("tr")!

describe("DataTable interactive targets", () => {
  function Harness({ onRowClick, onRowDoubleClick }: { onRowClick?: () => void; onRowDoubleClick?: () => void }) {
    const selection = useIdSelection<number>()
    const columns: ColumnDef<Row>[] = [
      nameCol,
      {
        key: "x",
        header: "X",
        cell: (r) =>
          r.id === 1 ? (
            <>
              <button>btn</button>
              <a href="#x">link</a>
              <input aria-label="field" />
              <button role="switch" aria-checked="false" aria-label="sw" />
              <span data-no-row-select>
                <i>custom</i>
              </span>
              {createPortal(<span>portal</span>, document.body)}
            </>
          ) : null,
      },
    ]
    return (
      <>
        <output data-testid="sel">{Array.from(selection.selected).sort().join(",")}</output>
        <DataTable
          rows={ROWS}
          getRowId={getRowId}
          columns={columns}
          selection="multi"
          selectionState={selection}
          getRowLabel={(r) => `Select ${r.name}`}
          onRowClick={onRowClick}
          onRowDoubleClick={onRowDoubleClick}
        />
      </>
    )
  }
  const sel = () => screen.getByTestId("sel").textContent

  it.each([
    ["button", () => screen.getByText("btn")],
    ["link", () => screen.getByText("link")],
    ["input", () => screen.getByLabelText("field")],
    ["switch", () => screen.getByRole("switch", { name: "sw" })],
    ["data-no-row-select (nested target)", () => screen.getByText("custom")],
    ["portal child", () => screen.getByText("portal")],
  ])("%s does not select, drag or fire row handlers", (_n, target) => {
    const onClick = vi.fn()
    const onDouble = vi.fn()
    render(<Harness onRowClick={onClick} onRowDoubleClick={onDouble} />)
    const el = target()
    expect(fireEvent.mouseDown(el)).toBe(true) // default not prevented: keeps native focus
    fireEvent.mouseEnter(row("B")) // would extend a drag
    fireEvent.mouseUp(window)
    fireEvent.click(el)
    fireEvent.doubleClick(el)
    expect(sel()).toBe("")
    expect(onClick).not.toHaveBeenCalled()
    expect(onDouble).not.toHaveBeenCalled()
  })

  it("a plain cell still selects and fires the handlers", () => {
    const onClick = vi.fn()
    const onDouble = vi.fn()
    render(<Harness onRowClick={onClick} onRowDoubleClick={onDouble} />)
    fireEvent.mouseDown(screen.getByText("B"))
    fireEvent.click(screen.getByText("B"))
    fireEvent.doubleClick(screen.getByText("B"))
    expect(sel()).toBe("2")
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onDouble).toHaveBeenCalledTimes(1)
  })

  it("an ignored press does not start a drag", () => {
    render(<Harness />)
    fireEvent.mouseDown(screen.getByText("btn"))
    fireEvent.mouseEnter(row("C"))
    expect(sel()).toBe("")
  })

  it("checkboxes keep toggling without clearing", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("checkbox", { name: "Select A" }))
    await user.click(screen.getByRole("checkbox", { name: "Select C" }))
    expect(sel()).toBe("1,3")
  })

  it("radios keep selecting only their row", async () => {
    const user = userEvent.setup()
    render(
      <DataTable rows={ROWS} getRowId={getRowId} columns={[nameCol]} selection="single" getRowLabel={(r) => `Select ${r.name}`} />,
    )
    await user.click(screen.getByRole("radio", { name: "Select B" }))
    await user.click(screen.getByRole("radio", { name: "Select D" }))
    expect(screen.getByRole("radio", { name: "Select D" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "Select B" })).toHaveAttribute("aria-checked", "false")
  })
})

describe("DataTable no-op selection updates", () => {
  const selectAllSpy = vi.fn()
  const seen: Set<number>[] = []

  function Harness() {
    const selection = useIdSelection<number>()
    const spied = {
      ...selection,
      selectAll: (ids: number[]) => {
        selectAllSpy(ids)
        selection.selectAll(ids)
      },
    }
    seen.push(selection.selected)
    return <DataTable rows={ROWS} getRowId={getRowId} columns={[nameCol]} selection="multi" selectionState={spied} />
  }

  it("skips selectAll when a drag re-enters rows inside the existing range", () => {
    selectAllSpy.mockClear()
    render(<Harness />)
    fireEvent.mouseDown(row("B"))
    fireEvent.mouseEnter(row("B")) // same row: range is just B
    expect(selectAllSpy).not.toHaveBeenCalled()
    fireEvent.mouseEnter(row("C"))
    fireEvent.mouseEnter(row("D"))
    expect(selectAllSpy).toHaveBeenCalledTimes(2)
    const afterDrag = seen[seen.length - 1]
    fireEvent.mouseEnter(row("D")) // unchanged range B..D
    expect(selectAllSpy).toHaveBeenCalledTimes(2)
    expect(seen[seen.length - 1]).toBe(afterDrag) // same Set object, no extra render with a new one
    fireEvent.mouseEnter(row("C")) // shrinks to B..C: a real change
    expect(selectAllSpy).toHaveBeenCalledTimes(3)
  })

  it("skips selectAll for a shift-click that reproduces the current selection", () => {
    selectAllSpy.mockClear()
    render(<Harness />)
    fireEvent.mouseDown(row("B"))
    fireEvent.mouseUp(window)
    fireEvent.mouseDown(row("D"), { shiftKey: true })
    expect(selectAllSpy).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(row("D"), { shiftKey: true })
    expect(selectAllSpy).toHaveBeenCalledTimes(1)
  })
})

describe("DataTable lazy context menu", () => {
  const columns = [nameCol]
  function setup(selection: "multi" | "none" = "multi") {
    const build = vi.fn((rows: Row[]): ContextMenuItemDef<Row>[] => [{ key: "act", label: `Act ${rows.length}`, onSelect: onSelect }])
    const onSelect = vi.fn()
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={columns} selection={selection} contextMenu={build} />)
    return { build, onSelect }
  }

  it("does not call the builder until the menu opens, nor on re-renders while closed", () => {
    const { build } = setup()
    fireEvent.mouseDown(row("A"))
    fireEvent.mouseUp(window)
    fireEvent.mouseDown(row("B"), { ctrlKey: true })
    expect(build).not.toHaveBeenCalled()
  })

  it("builds from the right-clicked unselected row", () => {
    const { build, onSelect } = setup()
    fireEvent.mouseDown(row("A"))
    fireEvent.mouseUp(window)
    fireEvent.contextMenu(row("C"))
    expect(build).toHaveBeenCalled()
    expect(build.mock.lastCall![0]).toEqual([ROWS[2]])
    fireEvent.click(screen.getByRole("menuitem", { name: "Act 1" }))
    expect(onSelect).toHaveBeenCalledWith([ROWS[2]])
  })

  it("builds from the selected row", () => {
    const { build } = setup()
    fireEvent.mouseDown(row("B"))
    fireEvent.mouseUp(window)
    fireEvent.contextMenu(row("B"))
    expect(build.mock.lastCall![0]).toEqual([ROWS[1]])
  })

  it("builds from the whole multi-selection and onSelect receives it", () => {
    const { build, onSelect } = setup()
    fireEvent.mouseDown(row("A"))
    fireEvent.mouseUp(window)
    fireEvent.mouseDown(row("D"), { ctrlKey: true })
    fireEvent.contextMenu(row("D"))
    expect(build.mock.lastCall![0]).toEqual([ROWS[0], ROWS[3]])
    fireEvent.click(screen.getByRole("menuitem", { name: "Act 2" }))
    expect(onSelect).toHaveBeenCalledWith([ROWS[0], ROWS[3]])
  })

  it("acts on the clicked row without selection", () => {
    const { build } = setup("none")
    fireEvent.contextMenu(row("E"))
    expect(build.mock.lastCall![0]).toEqual([ROWS[4]])
  })

  it("header right-click opens nothing and never calls the builder", () => {
    const { build } = setup()
    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "Name" }))
    expect(screen.queryByRole("menu")).toBeNull()
    expect(build).not.toHaveBeenCalled()
  })
})

describe("DataTable memoized rows", () => {
  const many: Row[] = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `R${i + 1}` }))
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
  const reset = () => {
    renders = {}
  }

  function Harness({ rows = many, columns = spyColumns }: { rows?: Row[]; columns?: ColumnDef<Row>[] }) {
    const selection = useIdSelection<number>()
    return (
      <DataTable
        rows={rows}
        getRowId={getRowId}
        columns={columns}
        selection="multi"
        selectionState={selection}
        // inline lambdas on purpose: they must not defeat the memo
        onRowClick={() => {}}
        rowClassName={() => undefined}
        getRowLabel={(r) => `Select ${r.name}`}
      />
    )
  }

  it("a click re-renders only the newly and previously selected rows", () => {
    render(<Harness />)
    reset()
    fireEvent.mouseDown(row("R3"))
    fireEvent.mouseUp(window)
    expect(renders).toEqual({ R3: 1 })
    reset()
    fireEvent.mouseDown(row("R7"))
    fireEvent.mouseUp(window)
    expect(renders).toEqual({ R3: 1, R7: 1 })
  })

  it("a drag renders each row at most once more", () => {
    render(<Harness />)
    reset()
    fireEvent.mouseDown(row("R2"))
    for (let i = 3; i <= 11; i++) fireEvent.mouseEnter(row(`R${i}`))
    fireEvent.mouseUp(window)
    expect(Object.keys(renders)).toHaveLength(10)
    expect(Math.max(...Object.values(renders))).toBe(1)
    expect(total()).toBe(10)
    reset()
    fireEvent.mouseDown(row("R15")) // new single selection: 10 deselected + 1 selected
    fireEvent.mouseUp(window)
    expect(total()).toBe(11)
  })

  it("a data change to one row re-renders only that row", () => {
    const { rerender } = render(<Harness />)
    reset()
    rerender(<Harness rows={many.map((r) => (r.id === 4 ? { ...r, name: "R4x" } : r))} />)
    expect(renders).toEqual({ R4x: 1 })
  })

  it("changing columns re-renders every row; the same columns do not", () => {
    const { rerender } = render(<Harness />)
    reset()
    rerender(<Harness />)
    expect(total()).toBe(0)
    rerender(<Harness columns={[...spyColumns]} />)
    expect(total()).toBe(many.length)
  })

  it("inline row handlers still see the latest closure", () => {
    const seen: number[] = []
    function Counter() {
      const [n, setN] = useState(0)
      return (
        <>
          <button onClick={() => setN((v) => v + 1)}>bump</button>
          <DataTable rows={ROWS} getRowId={getRowId} columns={[nameCol]} onRowClick={() => seen.push(n)} />
        </>
      )
    }
    render(<Counter />)
    fireEvent.click(screen.getByText("bump"))
    fireEvent.click(screen.getByText("bump"))
    fireEvent.click(row("A"))
    expect(seen).toEqual([2])
  })
})

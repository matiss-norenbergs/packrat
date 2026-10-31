import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createPortal } from "react-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useIdSelection } from "@/hooks/useIdSelection"
import { DataTable } from "./DataTable"
import type { ColumnDef } from "./types"

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

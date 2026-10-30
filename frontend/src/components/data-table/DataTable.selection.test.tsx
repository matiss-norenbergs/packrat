import { useState } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { useIdSelection } from "@/hooks/useIdSelection"
import { DataTable } from "./DataTable"
import type { SelectionMode } from "./useTableSelection"

afterEach(cleanup)

interface Row {
  id: number
  name: string
}
const ROWS: Row[] = ["A", "B", "C", "D", "E"].map((name, i) => ({ id: i + 1, name }))

function Harness({ mode, rows = ROWS }: { mode: SelectionMode; rows?: Row[] }) {
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
      />
    </>
  )
}

const sel = () => screen.getByTestId("sel").textContent
const row = (name: string) => screen.getByText(name).closest("tr")!

describe("DataTable selection: none", () => {
  it("renders no selection column and ignores clicks", () => {
    render(<Harness mode="none" />)
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.queryByRole("radio")).toBeNull()
    fireEvent.mouseDown(row("A"))
    expect(sel()).toBe("")
    expect(row("A")).not.toHaveAttribute("aria-selected")
  })
})

describe("DataTable selection: multi", () => {
  it("plain click selects only that row", () => {
    render(<Harness mode="multi" />)
    fireEvent.mouseDown(row("B"))
    fireEvent.mouseUp(window)
    fireEvent.mouseDown(row("D"))
    expect(sel()).toBe("4")
    expect(row("D")).toHaveAttribute("aria-selected", "true")
    expect(row("B")).toHaveAttribute("aria-selected", "false")
    expect(row("D")).toHaveAttribute("data-state", "selected")
  })

  it("ctrl/cmd-click toggles without clearing", () => {
    render(<Harness mode="multi" />)
    fireEvent.mouseDown(row("A"))
    fireEvent.mouseUp(window)
    fireEvent.mouseDown(row("C"), { ctrlKey: true })
    expect(sel()).toBe("1,3")
    fireEvent.mouseDown(row("A"), { metaKey: true })
    expect(sel()).toBe("3")
  })

  it("shift-click selects the range from the anchor", () => {
    render(<Harness mode="multi" />)
    fireEvent.mouseDown(row("B"))
    fireEvent.mouseUp(window)
    fireEvent.mouseDown(row("D"), { shiftKey: true })
    expect(sel()).toBe("2,3,4")
    fireEvent.mouseDown(row("A"), { shiftKey: true })
    expect(sel()).toBe("1,2")
  })

  it("shift-click without an anchor falls back to a plain select", () => {
    render(<Harness mode="multi" />)
    fireEvent.mouseDown(row("C"), { shiftKey: true })
    expect(sel()).toBe("3")
  })

  it("dragging extends the range until mouseup anywhere on the window", () => {
    render(<Harness mode="multi" />)
    fireEvent.mouseDown(row("B"))
    fireEvent.mouseEnter(row("C"))
    fireEvent.mouseEnter(row("D"))
    expect(sel()).toBe("2,3,4")
    fireEvent.mouseEnter(row("A"))
    expect(sel()).toBe("1,2")
    fireEvent.mouseUp(window)
    fireEvent.mouseEnter(row("E"))
    expect(sel()).toBe("1,2")
  })

  it("ignores non-primary buttons and prevents native text selection", () => {
    render(<Harness mode="multi" />)
    fireEvent.mouseDown(row("A"), { button: 2 })
    expect(sel()).toBe("")
    expect(fireEvent.mouseDown(row("A"))).toBe(false) // default prevented
  })

  it("checkbox toggles without clearing the rest", async () => {
    const user = userEvent.setup()
    render(<Harness mode="multi" />)
    await user.click(screen.getByRole("checkbox", { name: "Select A" }))
    await user.click(screen.getByRole("checkbox", { name: "Select C" }))
    expect(sel()).toBe("1,3")
    await user.click(screen.getByRole("checkbox", { name: "Select A" }))
    expect(sel()).toBe("3")
  })

  it("select-all selects the page's rows, reflects partial state and clears", async () => {
    const user = userEvent.setup()
    render(<Harness mode="multi" />)
    const all = screen.getByRole("checkbox", { name: "Select all" })
    expect(all).toHaveAttribute("aria-checked", "false")
    await user.click(screen.getByRole("checkbox", { name: "Select B" }))
    expect(all).toHaveAttribute("aria-checked", "mixed")
    await user.click(all)
    expect(sel()).toBe("1,2,3,4,5")
    expect(all).toHaveAttribute("aria-checked", "true")
    await user.click(all)
    expect(sel()).toBe("")
  })

  it("works without a controlled selectionState", async () => {
    const user = userEvent.setup()
    render(<DataTable rows={ROWS} getRowId={(r) => r.id} columns={[{ key: "n", header: "N", cell: (r) => r.name }]} selection="multi" />)
    await user.click(screen.getAllByRole("checkbox")[1])
    expect(screen.getAllByRole("checkbox")[1]).toHaveAttribute("aria-checked", "true")
  })

  it("supports string ids", () => {
    function Strings() {
      const selection = useIdSelection<string>()
      return (
        <>
          <output data-testid="sel">{Array.from(selection.selected).join("|")}</output>
          <DataTable
            rows={[{ id: "x/1" }, { id: "x/2" }, { id: "x/3" }]}
            getRowId={(r: { id: string }) => r.id}
            columns={[{ key: "n", header: "N", cell: (r: { id: string }) => r.id }]}
            selection="multi"
            selectionState={selection}
          />
        </>
      )
    }
    render(<Strings />)
    fireEvent.mouseDown(screen.getByText("x/1").closest("tr")!)
    fireEvent.mouseDown(screen.getByText("x/3").closest("tr")!, { shiftKey: true })
    expect(sel()).toBe("x/1|x/2|x/3")
  })
})

describe("DataTable selection: single", () => {
  it("renders radios and a radiogroup, no checkboxes", () => {
    render(<Harness mode="single" />)
    expect(screen.getByRole("radiogroup")).toBeInTheDocument()
    expect(screen.getAllByRole("radio")).toHaveLength(5)
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("clicking a row selects only that row; ctrl/shift/drag never multi-select", () => {
    render(<Harness mode="single" />)
    fireEvent.mouseDown(row("B"))
    expect(sel()).toBe("2")
    fireEvent.mouseDown(row("D"), { ctrlKey: true })
    expect(sel()).toBe("4")
    fireEvent.mouseDown(row("A"), { shiftKey: true })
    expect(sel()).toBe("1")
    fireEvent.mouseEnter(row("C"))
    expect(sel()).toBe("1")
  })

  it("clicking a radio selects only that row", async () => {
    const user = userEvent.setup()
    render(<Harness mode="single" />)
    await user.click(screen.getByRole("radio", { name: "Select C" }))
    expect(sel()).toBe("3")
    await user.click(screen.getByRole("radio", { name: "Select E" }))
    expect(sel()).toBe("5")
    expect(screen.getByRole("radio", { name: "Select C" })).toHaveAttribute("aria-checked", "false")
    expect(screen.getByRole("radio", { name: "Select E" })).toHaveAttribute("aria-checked", "true")
  })

  it("has no select-all in the header", () => {
    render(<Harness mode="single" />)
    expect(screen.queryByRole("checkbox", { name: "Select all" })).toBeNull()
  })

  it("keeps working when the page re-renders with other rows", () => {
    function Paged() {
      const [page, setPage] = useState(0)
      return (
        <>
          <button onClick={() => setPage(1)}>next</button>
          <Harness mode="single" rows={ROWS.slice(page * 2, page * 2 + 2)} />
        </>
      )
    }
    render(<Paged />)
    fireEvent.mouseDown(row("A"))
    fireEvent.click(screen.getByText("next"))
    expect(screen.getAllByRole("radio")).toHaveLength(2)
    fireEvent.mouseDown(row("C"))
    expect(sel()).toBe("3")
  })
})

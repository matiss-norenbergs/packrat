import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { DataTable } from "./DataTable"
import { computeLayout } from "./columns"
import type { ColumnDef } from "./types"

afterEach(cleanup)

interface Row {
  id: number
  name: string
}
const ROWS: Row[] = [
  { id: 1, name: "Alpha" },
  { id: 2, name: "Beta" },
]
const getRowId = (r: Row) => r.id
const col = (over: Partial<ColumnDef<Row>> & { key: string }): ColumnDef<Row> => ({
  header: over.key,
  cell: (r) => r.name,
  ...over,
})

const headerOf = (name: string) => screen.getByRole("columnheader", { name })
const firstCellOf = (index: number) => within(screen.getAllByRole("row")[1]).getAllByRole("cell")[index]

describe("DataTable alignment presets", () => {
  it.each([
    ["text", "text-left"],
    [undefined, "text-left"],
    ["number", "text-right"],
    ["date", "text-center"],
    ["status", "text-center"],
    ["switch", "text-center"],
    ["icon", "text-center"],
  ] as const)("type %s aligns header and cells with %s", (type, expected) => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "c", type })]} />)
    expect(headerOf("c")).toHaveClass(expected)
    expect(firstCellOf(0)).toHaveClass(expected)
  })

  it("lets align override the preset", () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "c", type: "number", align: "left" })]} />)
    expect(headerOf("c")).toHaveClass("text-left")
    expect(firstCellOf(0)).toHaveClass("text-left")
    expect(firstCellOf(0)).not.toHaveClass("text-right")
  })

  it("wraps icon cells in a centring flex box", () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "c", type: "icon", cell: () => <svg data-testid="i" /> })]} />)
    expect(screen.getAllByTestId("i")[0].parentElement).toHaveClass("flex", "justify-center")
  })

  it("applies header and cell class names", () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "c", headerClassName: "hh", cellClassName: "cc" })]} />)
    expect(headerOf("c")).toHaveClass("hh")
    expect(firstCellOf(0)).toHaveClass("cc")
  })
})

const colWidths = (container: HTMLElement) => Array.from(container.querySelectorAll("col")).map((c) => (c as HTMLElement).style.width)
const table = () => screen.getByRole("table")

describe("DataTable widths", () => {
  it.each([
    ["text", "200px"],
    [undefined, "200px"],
    ["number", "110px"],
    ["date", "180px"],
    ["status", "130px"],
    ["icon", "64px"],
    ["switch", "96px"],
  ] as const)("gives a %s column its default width", (type, expected) => {
    const { container } = render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a", type })]} />)
    expect(colWidths(container)).toEqual([expected, ""])
  })

  it("is always table-layout fixed with a colgroup, and the table sums to its min-width", () => {
    const { container } = render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a" }), col({ key: "b", type: "number" })]} />)
    expect(container.querySelector("colgroup")).not.toBeNull()
    expect(table()).toHaveClass("table-fixed", "w-full")
    expect(table().style.minWidth).toBe("310px")
  })

  it("uses an explicit width over the type default", () => {
    const { container } = render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a", type: "date", width: 150 })]} />)
    expect(colWidths(container)).toEqual(["150px", ""])
  })

  it("never lays a column out below its minWidth (explicit or default 48)", () => {
    const { container } = render(
      <DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a", width: 40, minWidth: 90 }), col({ key: "b", width: 10 }), col({ key: "c", width: 100, minWidth: 60 })]} />,
    )
    expect(colWidths(container)).toEqual(["90px", "48px", "100px", ""])
    expect(table().style.minWidth).toBe("238px")
  })

  it("adds the selection column's width to the min-width and the colgroup", () => {
    const { container } = render(<DataTable rows={ROWS} getRowId={getRowId} selection="multi" columns={[col({ key: "a", width: 100 })]} />)
    expect(colWidths(container)).toEqual(["32px", "100px", ""])
    expect(table().style.minWidth).toBe("132px")
  })

  it("ends a table without flex columns in an empty, aria-hidden filler column", () => {
    const { container } = render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a", width: 100 })]} />)
    const last = container.querySelectorAll("col")[1] as HTMLElement
    expect(last.getAttribute("style")).toBeNull()
    for (const tr of Array.from(container.querySelectorAll("tr"))) {
      const filler = tr.lastElementChild as HTMLElement
      expect(filler).toHaveAttribute("aria-hidden", "true")
      expect(filler.textContent).toBe("")
      expect(filler).toHaveClass("p-0")
      expect(tr.children).toHaveLength(2)
    }
  })

  it("keeps the filler out of the accessible headers, cells and row selection", async () => {
    const user = userEvent.setup()
    render(<DataTable rows={ROWS} getRowId={getRowId} selection="multi" columns={[col({ key: "a" })]} />)
    expect(screen.getAllByRole("columnheader")).toHaveLength(2)
    expect(within(screen.getAllByRole("row")[1]).getAllByRole("cell")).toHaveLength(2)
    const row = screen.getAllByRole("row")[1]
    await user.click(row.lastElementChild!) // a click on the filler behaves like a click on the row
    expect(row).toHaveAttribute("aria-selected", "true")
    expect(screen.getAllByRole("row")[2]).toHaveAttribute("aria-selected", "false")
  })

  it("lets a flex column absorb the space: no colgroup width, no filler, its width is the minimum", () => {
    const { container } = render(
      <DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a", width: 100 }), col({ key: "b", width: 300, flex: true }), col({ key: "c", width: 50 })]} />,
    )
    expect(colWidths(container)).toEqual(["100px", "", "50px"])
    expect(table().style.minWidth).toBe("450px")
    expect(container.querySelector("[aria-hidden=true]")).toBeNull()
    expect(container.querySelector("tr")!.children).toHaveLength(3)
  })

  it("lets several flex columns share the spare width (all unsized, no filler)", () => {
    const { container } = render(
      <DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a", flex: true }), col({ key: "b", width: 80 }), col({ key: "c", type: "number", flex: true })]} />,
    )
    expect(colWidths(container)).toEqual(["", "80px", ""])
    expect(table().style.minWidth).toBe("390px")
  })

  it("computeLayout: no flex means a filler, any flex means none", () => {
    expect(computeLayout([col({ key: "a" })], null).filler).toBe(true)
    expect(computeLayout([col({ key: "a" }), col({ key: "b", flex: true })], null).filler).toBe(false)
    expect(computeLayout([col({ key: "a", width: 100 }), col({ key: "b", minWidth: 60, width: 20 })], 32)).toEqual({
      colWidths: [100, 60],
      minWidth: 192,
      filler: true,
    })
  })

  it("renders no more cells than before when rerendered (rows stay memoized)", () => {
    let renders = 0
    const columns = [col({ key: "a", cell: (r) => (renders++, r.name) })]
    const { rerender } = render(<DataTable rows={ROWS} getRowId={getRowId} columns={columns} />)
    expect(renders).toBe(2)
    rerender(<DataTable rows={ROWS} getRowId={getRowId} columns={columns} className="x" />)
    expect(renders).toBe(2)
  })

  it("lets the root shrink below the table's min-width so the scroll container scrolls (grid parents such as dialogs)", () => {
    const { container } = render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a" })]} />)
    expect(container.firstElementChild).toHaveClass("min-w-0", "min-h-0", "flex-1")
  })

  it("uses the table scroll container with a sticky header", () => {
    const { container } = render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a" })]} />)
    expect(container.querySelector("[data-slot=table-container]")).toHaveClass("h-full", "overflow-auto")
    expect(container.querySelector("thead")).toHaveClass("sticky", "top-0")
  })
})

describe("DataTable clipping and wrap", () => {
  it("clips cells and headers with an ellipsis by default", () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a" })]} />)
    for (const el of [headerOf("a"), firstCellOf(0)]) expect(el).toHaveClass("overflow-hidden", "text-ellipsis", "whitespace-nowrap")
  })

  it("lets a wrap column's cells and header wrap, with long words breaking", () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a", wrap: true })]} />)
    for (const el of [headerOf("a"), firstCellOf(0)]) {
      expect(el).toHaveClass("whitespace-normal", "break-words")
      expect(el).not.toHaveClass("whitespace-nowrap", "text-ellipsis", "overflow-hidden")
    }
  })
})

describe("DataTable states", () => {
  it("renders rows with data-row-id, string ids included", () => {
    render(
      <DataTable
        rows={[{ id: "a/1", name: "X" }]}
        getRowId={(r: { id: string; name: string }) => r.id}
        columns={[{ key: "n", header: "n", cell: (r: { name: string }) => r.name }]}
      />,
    )
    expect(screen.getAllByRole("row")[1]).toHaveAttribute("data-row-id", "a/1")
  })

  it("shows the configured number of skeletons while loading", () => {
    const { container } = render(<DataTable rows={[]} getRowId={getRowId} columns={[col({ key: "a" })]} loading loadingRows={4} />)
    expect(container.querySelectorAll("[data-slot=skeleton]")).toHaveLength(4)
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("shows the empty node when there are no rows", () => {
    render(<DataTable rows={[]} getRowId={getRowId} columns={[col({ key: "a" })]} empty={<p>Nothing here</p>} />)
    expect(screen.getByText("Nothing here")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("shows the error node instead of the table", () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a" })]} error={<p>Boom</p>} />)
    expect(screen.getByText("Boom")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("merges rowClassName", () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a" })]} rowClassName={(r) => (r.id === 2 ? "special" : undefined)} />)
    expect(screen.getAllByRole("row")[2]).toHaveClass("special")
    expect(screen.getAllByRole("row")[1]).not.toHaveClass("special")
  })
})

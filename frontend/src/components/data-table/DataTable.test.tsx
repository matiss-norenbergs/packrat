import { cleanup, render, screen, within } from "@testing-library/react"
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

describe("DataTable widths", () => {
  it("keeps auto layout and no colgroup when no column has a width", () => {
    const { container } = render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a" }), col({ key: "b" })]} />)
    expect(container.querySelector("colgroup")).toBeNull()
    expect(screen.getByRole("table")).not.toHaveClass("table-fixed")
    expect(screen.getByRole("table").style.minWidth).toBe("")
  })

  it("emits a fixed colgroup and a min-width equal to the sum of the widths", () => {
    const { container } = render(
      <DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a", width: 100 }), col({ key: "b", width: 200, flex: true }), col({ key: "c", width: 50 })]} />,
    )
    const cols = Array.from(container.querySelectorAll("col")) as HTMLElement[]
    expect(cols.map((c) => c.style.width)).toEqual(["100px", "", "50px"])
    expect(screen.getByRole("table")).toHaveClass("table-fixed")
    expect(screen.getByRole("table").style.minWidth).toBe("350px")
  })

  it("lets the last column absorb the slack when none is flex", () => {
    const { container } = render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a", width: 100 }), col({ key: "b", width: 80 })]} />)
    const cols = Array.from(container.querySelectorAll("col")) as HTMLElement[]
    expect(cols.map((c) => c.style.width)).toEqual(["100px", ""])
    expect(screen.getByRole("table").style.minWidth).toBe("180px")
  })

  it("counts minWidth / a default for width-less columns in a fixed layout", () => {
    const layout = computeLayout([col({ key: "a", width: 100 }), col({ key: "b", minWidth: 60 }), col({ key: "c", flex: true })], 32)
    expect(layout.colWidths).toEqual([100, 60, undefined])
    expect(layout.minWidth).toBe(32 + 100 + 60 + 120)
  })

  it("applies minWidth to header cells", () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a", minWidth: 90 })]} />)
    expect(headerOf("a").style.minWidth).toBe("90px")
  })

  it("uses the table scroll container with a sticky header", () => {
    const { container } = render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a" })]} />)
    expect(container.querySelector("[data-slot=table-container]")).toHaveClass("h-full", "overflow-auto")
    expect(container.querySelector("thead")).toHaveClass("sticky", "top-0")
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

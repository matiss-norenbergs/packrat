import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { DataTable } from "./DataTable"
import type { ColumnDef } from "./types"

afterEach(cleanup)

interface Row {
  id: number
  name: string
}
const ROWS: Row[] = [
  { id: 1, name: "Alpha" },
  { id: 2, name: "Beta" },
  { id: 3, name: "Gamma" },
]
const getRowId = (r: Row) => r.id
const col = (over: Partial<ColumnDef<Row>> & { key: string }): ColumnDef<Row> => ({
  header: over.key,
  cell: (r) => r.name,
  ...over,
})

const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)))
const SHOW = 300 // the 200 ms delay plus slack

// jsdom has no layout: pretend an element's content is wider than its box.
function overflow(el: Element, scroll = 300, client = 100) {
  Object.defineProperty(el, "scrollWidth", { value: scroll, configurable: true })
  Object.defineProperty(el, "clientWidth", { value: client, configurable: true })
}

const row = (n: number) => screen.getAllByRole("row")[n]
const cell = (r: number, c: number) => row(r).querySelectorAll("td")[c] as HTMLElement
const enter = (el: Element) => fireEvent.pointerOver(el)
const tooltip = () => screen.queryByRole("tooltip")

async function hoverShows(el: Element) {
  enter(el)
  await sleep(SHOW)
  return tooltip()
}

describe("DataTable overflow tooltip", () => {
  it("shows the full text of a cut-off cell after the delay, and only then", async () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a" })]} />)
    overflow(cell(1, 0))
    enter(cell(1, 0))
    expect(tooltip()).toBeNull()
    await sleep(SHOW)
    expect(tooltip()).toHaveTextContent("Alpha")
  })

  it("stays away from cells that fit", async () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a" })]} />)
    overflow(cell(1, 0), 100, 100)
    expect(await hoverShows(cell(1, 0))).toBeNull()
  })

  it("checks descendants too: an inner truncated block cuts the cell off", async () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a", cell: (r) => <p className="truncate">{r.name}</p> })]} />)
    overflow(cell(1, 0).querySelector("p")!)
    expect(await hoverShows(cell(1, 0))).toHaveTextContent("Alpha")
  })

  it("reads a two-line cell as two lines (innerText)", async () => {
    render(
      <DataTable
        rows={ROWS}
        getRowId={getRowId}
        columns={[col({ key: "a", cell: (r) => (<><p>{r.name}</p><p>second</p></>) })]}
      />,
    )
    overflow(cell(1, 0))
    Object.defineProperty(cell(1, 0), "innerText", { value: "Alpha\n\nsecond", configurable: true })
    expect(await hoverShows(cell(1, 0))).toHaveTextContent("Alpha second")
    expect(tooltip()!.textContent).toBe("Alpha\nsecond")
  })

  it("uses tooltipText instead of the rendered text", async () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a", tooltipText: (r) => `full ${r.name}` })]} />)
    overflow(cell(2, 0))
    expect(await hoverShows(cell(2, 0))).toHaveTextContent("full Beta")
  })

  it("is off for tooltip:false, wrap, icon and switch columns", async () => {
    const columns = [
      col({ key: "a", tooltip: false }),
      col({ key: "b", wrap: true }),
      col({ key: "c", type: "icon", cell: () => "i" }),
      col({ key: "d", type: "switch", cell: () => "s" }),
    ]
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={columns} />)
    for (let c = 0; c < 4; c++) {
      overflow(cell(1, c))
      expect(await hoverShows(cell(1, c))).toBeNull()
      fireEvent.pointerLeave(row(1).parentElement!)
    }
  })

  it("is off for cells with an interactive element", async () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a", cell: (r) => <a href="/x">{r.name}</a> }), col({ key: "b", cell: () => <button>go</button> })]} />)
    overflow(cell(1, 0))
    overflow(cell(1, 1))
    expect(await hoverShows(cell(1, 0))).toBeNull()
    expect(await hoverShows(cell(1, 1))).toBeNull()
  })

  it("is off for the selection column and the filler", async () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} selection="multi" columns={[col({ key: "a" })]} />)
    const tds = row(1).querySelectorAll("td")
    expect(tds).toHaveLength(3)
    overflow(tds[0])
    overflow(tds[2])
    expect(await hoverShows(tds[0])).toBeNull()
    expect(await hoverShows(tds[2])).toBeNull()
  })

  it("closes on mouse down and stays off for the rest of the drag, until the button is released", async () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} selection="multi" columns={[col({ key: "a" })]} />)
    for (const r of [1, 2, 3]) overflow(cell(r, 1))
    expect(await hoverShows(cell(1, 1))).not.toBeNull()
    fireEvent.mouseDown(cell(1, 1))
    expect(tooltip()).toBeNull()
    expect(await hoverShows(cell(2, 1))).toBeNull() // dragging over another row
    fireEvent.mouseUp(window)
    expect(await hoverShows(cell(3, 1))).not.toBeNull()
  })

  it("closes on scroll, Escape, context menu and when the pointer leaves the body", async () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a" })]} />)
    overflow(cell(1, 0))
    const closers: [string, () => void][] = [
      ["scroll", () => fireEvent.scroll(document.querySelector("[data-slot=table-container]")!)],
      ["Escape", () => fireEvent.keyDown(document.body, { key: "Escape" })],
      ["contextmenu", () => fireEvent.contextMenu(cell(1, 0))],
      ["leave", () => fireEvent.pointerLeave(row(1).parentElement!)],
    ]
    for (const [name, close] of closers) {
      expect(await hoverShows(cell(1, 0)), name).not.toBeNull()
      act(close)
      expect(tooltip(), name).toBeNull()
      fireEvent.pointerLeave(row(1).parentElement!) // so the next round re-enters the cell
    }
  })

  it("measures on entry only: moving inside the same cell does not re-measure or flicker", async () => {
    render(<DataTable rows={ROWS} getRowId={getRowId} columns={[col({ key: "a", cell: (r) => <span>{r.name}</span> })]} />)
    overflow(cell(1, 0))
    expect(await hoverShows(cell(1, 0))).not.toBeNull()
    enter(cell(1, 0).querySelector("span")!)
    expect(tooltip()).not.toBeNull()
  })

  describe("never gets in the way", () => {
    it("lets a plain mouse down select the row (the event still reaches it)", async () => {
      render(<DataTable rows={ROWS} getRowId={getRowId} selection="multi" columns={[col({ key: "a" })]} />)
      overflow(cell(1, 1))
      await hoverShows(cell(1, 1))
      fireEvent.mouseDown(cell(1, 1))
      fireEvent.mouseUp(window)
      expect(row(1)).toHaveAttribute("aria-selected", "true")
    })

    it("keeps shift and ctrl selection working while a tooltip is open", async () => {
      const user = userEvent.setup()
      render(<DataTable rows={ROWS} getRowId={getRowId} selection="multi" columns={[col({ key: "a" })]} />)
      overflow(cell(1, 1))
      await hoverShows(cell(1, 1))
      await user.click(cell(1, 1))
      await user.keyboard("{Shift>}")
      await user.click(cell(3, 1))
      await user.keyboard("{/Shift}")
      expect([1, 2, 3].map((n) => row(n).getAttribute("aria-selected"))).toEqual(["true", "true", "true"])
      await user.keyboard("{Control>}")
      await user.click(cell(2, 1))
      await user.keyboard("{/Control}")
      expect([1, 2, 3].map((n) => row(n).getAttribute("aria-selected"))).toEqual(["true", "false", "true"])
    })

    it("still opens the context menu", async () => {
      const user = userEvent.setup()
      render(
        <DataTable
          rows={ROWS}
          getRowId={getRowId}
          columns={[col({ key: "a" })]}
          contextMenu={() => [{ key: "x", label: "Do it", onSelect: () => {} }]}
        />,
      )
      overflow(cell(1, 0))
      await hoverShows(cell(1, 0))
      await user.pointer({ keys: "[MouseRight]", target: cell(1, 0) })
      expect(await screen.findByRole("menuitem", { name: "Do it" })).toBeInTheDocument()
      expect(tooltip()).toBeNull()
    })
  })
})

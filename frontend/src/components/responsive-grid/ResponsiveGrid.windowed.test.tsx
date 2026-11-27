import { useState } from "react"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resetFocusReturn } from "@/lib/focusReturn"
import { installLayoutMock } from "@/test/layoutMock"
import type { LayoutMock } from "@/test/layoutMock"
import { ResponsiveGrid, VIRTUALIZE_THRESHOLD } from "./ResponsiveGrid"
import type { GridElementProps, ResponsiveGridProps } from "./ResponsiveGrid"

// Rows are 100px tall, the library preset's gap is 16px: a row takes 116px of a 600px viewport (about 5 rows, 3 more of
// overscan on each side).
const ROW = 100
const GAP = 16
const PAD = 4
let layout: LayoutMock

beforeEach(() => {
  layout = installLayoutMock({ viewportWidth: 1280, viewportHeight: 600, rowHeight: () => ROW })
})
afterEach(() => {
  cleanup()
  layout.restore()
  resetFocusReturn()
})

const make = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }))
type Row = { id: number }
const getKey = (r: Row) => `k${r.id}`
const renderRow = (r: Row) => <button data-testid="cell" data-id={r.id}>{`cell ${r.id}`}</button>

function grid(n: number, props: Partial<ResponsiveGridProps<Row>> = {}) {
  return <ResponsiveGrid items={make(n)} getKey={getKey} renderItem={renderRow} columns="library" scrollTestId="scroll" estimateRowHeight={ROW} virtualize {...props} />
}
const region = () => screen.getByTestId("scroll")
const rows = () => [...region().querySelectorAll<HTMLElement>("[data-first-item]")]
const ids = () => screen.queryAllByTestId("cell").map((c) => Number(c.dataset.id))
const scrollTo = (top: number) => act(() => layout.scrollTo(region(), top))
// The virtualizer holds a programmatic scroll back while a scroll is still "in progress" (150ms after the last scroll event).
const settleScroll = () => act(async () => void (await new Promise((r) => setTimeout(r, 300))))
const setWidth = async (w: number) => {
  await settleScroll()
  act(() => layout.setViewportWidth(w))
  await settleScroll()
}
const rowTop = (index: number) => PAD + index * (ROW + GAP)

describe("threshold", () => {
  it("renders every cell, in the plain DOM, at or below the threshold", () => {
    const stable = make(VIRTUALIZE_THRESHOLD)
    const windowed = render(<ResponsiveGrid items={stable} getKey={getKey} renderItem={renderRow} columns="library" virtualize />)
    const plain = render(<ResponsiveGrid items={stable} getKey={getKey} renderItem={renderRow} columns="library" />)
    expect(windowed.container.querySelectorAll("[data-first-item]")).toHaveLength(0)
    expect(windowed.container.querySelectorAll("[data-testid=cell]")).toHaveLength(VIRTUALIZE_THRESHOLD)
    expect(windowed.container.innerHTML).toBe(plain.container.innerHTML)
  })

  it("does not window without virtualize, however many items", () => {
    render(grid(1000, { virtualize: false }))
    expect(screen.getAllByTestId("cell")).toHaveLength(1000)
    expect(rows()).toHaveLength(0)
  })

  it("windows above the threshold, and a prop moves the threshold", () => {
    const { rerender } = render(grid(VIRTUALIZE_THRESHOLD + 1))
    expect(rows().length).toBeGreaterThan(0)
    rerender(grid(VIRTUALIZE_THRESHOLD + 1, { virtualizeThreshold: 5000 }))
    expect(rows()).toHaveLength(0)
    expect(screen.getAllByTestId("cell")).toHaveLength(VIRTUALIZE_THRESHOLD + 1)
  })
})

describe("the window", () => {
  it("mounts only the rows near the viewport, in item order, and the region keeps data-focus-region", () => {
    render(grid(1000))
    expect(region()).toHaveAttribute("data-focus-region")
    expect(screen.getAllByTestId("cell").length).toBeLessThan(60)
    const mounted = ids()
    expect(mounted[0]).toBe(0)
    expect(mounted).toEqual([...mounted].sort((a, b) => a - b))
    // the container is as tall as the 250 rows and their gaps, so the scrollbar matches the plain grid
    const container = region().firstElementChild as HTMLElement
    expect(container.style.height).toBe(`${250 * ROW + 249 * GAP}px`)
  })

  it("gives each row the preset's column rule and positions it by its offset", () => {
    render(grid(1000))
    const second = rows()[1]
    expect(second.className).toContain("grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4")
    expect(second.style.transform).toBe(`translateY(${ROW + GAP}px)`)
  })

  it("follows the scroll: the first rows leave and the rows at the offset come", () => {
    render(grid(1000))
    scrollTo(rowTop(100))
    const mounted = ids()
    expect(mounted.length).toBeLessThan(60)
    expect(mounted).not.toContain(0)
    expect(mounted).toContain(100 * 4)
    expect(rows()).toHaveLength(new Set(rows().map((r) => r.dataset.index)).size)
  })

  it("renders no cell again when the window moves over cells that stay", () => {
    const spy = vi.fn(renderRow)
    const stable = make(1000)
    render(<ResponsiveGrid items={stable} getKey={getKey} renderItem={spy} columns="library" scrollTestId="scroll" virtualize />)
    const built = spy.mock.calls.length
    expect(built).toBe(1000) // built once, up front, in the memo
    scrollTo(rowTop(1))
    scrollTo(rowTop(2))
    expect(spy.mock.calls.length).toBe(built)
  })

  it("keeps a row's DOM node and keys it by its first cell across a refetch with the same items", () => {
    const { rerender } = render(grid(1000))
    const before = rows()[2]
    rerender(grid(1000))
    expect(rows()[2]).toBe(before)
    expect(rows()[2].querySelector("[data-id]")?.getAttribute("data-id")).toBe("8")
  })
})

describe("columns", () => {
  it.each([
    [1280, 4],
    [1024, 4],
    [800, 3],
    [640, 3],
    [500, 2],
  ])("library at %ipx is %i columns", (width, columns) => {
    layout.setViewportWidth(width)
    render(grid(1000))
    expect(rows()[0].querySelectorAll("[data-testid=cell]")).toHaveLength(columns)
  })

  it.each([
    [1280, 6],
    [800, 4],
    [500, 2],
  ])("gallery at %ipx is %i columns", (width, columns) => {
    layout.setViewportWidth(width)
    render(grid(1000, { columns: "gallery" }))
    expect(rows()[0].querySelectorAll("[data-testid=cell]")).toHaveLength(columns)
  })

  it("re-chunks when a breakpoint is crossed and keeps the first visible item in view", async () => {
    render(grid(1000))
    scrollTo(rowTop(50)) // row 50 of 4 = item 200 at the top
    await setWidth(800) // 3 columns
    expect(rows()[0].querySelectorAll("[data-testid=cell]")).toHaveLength(3)
    // item 200 is in row 66 of 3 (item 198 starts it); the region is scrolled to that row
    expect(region().scrollTop).toBeCloseTo(rowTop(66), -1)
    const first = rows().find((r) => r.dataset.firstItem === "198")
    expect(first).toBeTruthy()
    await setWidth(500) // 2 columns: item 198 starts row 99
    expect(region().scrollTop).toBeCloseTo(rowTop(99), -1)
  })
})

describe("heterogeneous items", () => {
  it("chunks a mixed list of two kinds into rows in order", () => {
    type Cell = { kind: "folder" | "item"; id: number }
    const cells: Cell[] = [...[0, 1].map((id) => ({ kind: "folder" as const, id })), ...[0, 1, 2, 3, 4].map((id) => ({ kind: "item" as const, id }))]
    render(
      <ResponsiveGrid
        items={cells}
        getKey={(c) => `${c.kind}${c.id}`}
        renderItem={(c) => <i data-testid="cell">{`${c.kind}${c.id}`}</i>}
        columns="library"
        scrollTestId="scroll"
        virtualize
        virtualizeThreshold={2}
      />,
    )
    const text = rows().map((r) => [...r.querySelectorAll("[data-testid=cell]")].map((c) => c.textContent))
    expect(text).toEqual([
      ["folder0", "folder1", "item0", "item1"],
      ["item2", "item3", "item4"],
    ])
  })
})

describe("resetKey", () => {
  it("sends the region to the top when it changes, not on mount", () => {
    const { rerender } = render(grid(1000, { resetKey: "a" }))
    expect(region().scrollTop).toBe(0)
    scrollTo(rowTop(100))
    expect(ids()).not.toContain(0)
    rerender(grid(1000, { resetKey: "a" }))
    expect(region().scrollTop).toBe(rowTop(100)) // an unchanged key and unchanged items keep the position
    rerender(grid(1000, { resetKey: "b" }))
    expect(region().scrollTop).toBe(0)
    expect(ids()[0]).toBe(0)
  })
})

describe("what stays mounted", () => {
  it("keeps the row with keyboard focus when it scrolls out of the window", () => {
    render(grid(1000))
    const button = screen.getAllByTestId("cell")[1]
    button.focus()
    expect(document.activeElement).toBe(button)
    scrollTo(rowTop(100))
    expect(button.isConnected).toBe(true)
    expect(document.activeElement).toBe(button)
    // still in item order, the kept row first
    const mounted = ids()
    expect(mounted).toEqual([...mounted].sort((a, b) => a - b))
    expect(mounted).toContain(1)
    expect(mounted).toContain(400)
    // and it goes once focus has left
    button.blur()
    scrollTo(rowTop(101))
    expect(ids()).not.toContain(1)
  })

  it("keeps the row of the element a closing dialog will give focus back to", () => {
    render(grid(1000))
    const origin = screen.getAllByTestId("cell")[2]
    // the document-level contextmenu listener of lib/focusReturn records what a right-click pointed at
    act(() => void origin.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 })))
    scrollTo(rowTop(100))
    expect(origin.isConnected).toBe(true)
    resetFocusReturn()
    scrollTo(rowTop(101))
    expect(origin.isConnected).toBe(false)
  })
})

describe("the grid element", () => {
  function Wrapper({ className, style, windowed, children }: GridElementProps) {
    const [flag, setFlag] = useState(false)
    return (
      <div data-testid="wrapper" className={className} style={style} data-windowed={windowed ? "" : undefined} data-flag={flag ? "" : undefined}>
        <button data-testid="toggle" onClick={() => setFlag((f) => !f)} />
        {children}
      </div>
    )
  }

  it("windowed: carries gridClassName and the height, not the column rule; the rows carry it", () => {
    render(grid(1000, { gridClassName: "group/lib-grid", gridComponent: Wrapper }))
    const wrapper = screen.getByTestId("wrapper")
    expect(wrapper).toHaveAttribute("data-windowed")
    expect(wrapper.className).toContain("group/lib-grid")
    expect(wrapper.className).toContain("relative")
    expect(wrapper.className).not.toContain("grid-cols")
    expect(wrapper.style.height).not.toBe("")
    expect(rows()[0].className).toContain("grid-cols-2")
  })

  it("plain: unchanged, the classes carry the column rule and there is no windowed flag", () => {
    render(grid(10, { gridClassName: "group/lib-grid", gridComponent: Wrapper }))
    const wrapper = screen.getByTestId("wrapper")
    expect(wrapper).not.toHaveAttribute("data-windowed")
    expect(wrapper.className).toContain("grid-cols-2")
  })

  it("re-renders no cell when the wrapper's own state changes", () => {
    const spy = vi.fn((r: Row) => <b data-testid="cell">{r.id}</b>)
    const Counted = ({ r }: { r: Row }) => spy(r)
    const items = make(1000)
    render(<ResponsiveGrid items={items} getKey={getKey} renderItem={(r) => <Counted r={r} />} columns="library" gridComponent={Wrapper} virtualize />)
    const before = spy.mock.calls.length
    act(() => screen.getByTestId("toggle").click())
    expect(screen.getByTestId("wrapper")).toHaveAttribute("data-flag")
    expect(spy.mock.calls.length).toBe(before)
  })
})

describe("states", () => {
  it("shows loading instead of the window, and the window again after", () => {
    const { rerender } = render(grid(1000, { loading: true }))
    expect(rows()).toHaveLength(0)
    rerender(grid(1000))
    expect(rows().length).toBeGreaterThan(0)
  })
})

import { StrictMode, useState } from "react"
import type { ReactNode } from "react"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { COLUMN_PRESETS } from "./columns"
import { ResponsiveGrid } from "./ResponsiveGrid"
import type { GridElementProps, ResponsiveGridProps } from "./ResponsiveGrid"

afterEach(cleanup)

interface Row {
  id: number
  label: string
}
const rows: Row[] = [1, 2, 3].map((id) => ({ id, label: `row ${id}` }))
const getKey = (r: Row) => r.id
const renderRow = (r: Row) => <span data-testid="cell">{r.label}</span>

function grid(props: Partial<ResponsiveGridProps<Row>> = {}) {
  return <ResponsiveGrid items={rows} getKey={getKey} renderItem={renderRow} columns="library" scrollTestId="scroll" {...props} />
}
const region = () => screen.getByTestId("scroll")

describe("items", () => {
  it("renders every item through renderItem, in order, as direct children of the grid element", () => {
    render(grid())
    const cells = screen.getAllByTestId("cell")
    expect(cells.map((c) => c.textContent)).toEqual(["row 1", "row 2", "row 3"])
    expect(cells[0].parentElement).toBe(region().firstElementChild)
  })

  it("passes the index to getKey and renderItem", () => {
    const key = vi.fn((_: Row, i: number) => `k${i}`)
    const rend = vi.fn((r: Row, i: number) => <i>{`${i}:${r.id}`}</i>)
    render(grid({ getKey: key, renderItem: rend }))
    expect(screen.getByText("1:2")).toBeInTheDocument()
    expect(key).toHaveBeenCalledWith(rows[2], 2)
  })

  it("renders a heterogeneous list, the renderer deciding per item, with unique keys across kinds", () => {
    type Cell = { kind: "folder"; id: number } | { kind: "item"; id: number }
    // The same id in both kinds: only the key prefix keeps them apart.
    const cells: Cell[] = [
      { kind: "folder", id: 1 },
      { kind: "item", id: 1 },
    ]
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    render(
      <ResponsiveGrid
        items={cells}
        getKey={(c) => `${c.kind}${c.id}`}
        renderItem={(c) => (c.kind === "folder" ? <b data-testid="folder">F</b> : <i data-testid="item">I</i>)}
        columns="library"
      />,
    )
    expect(screen.getByTestId("folder")).toBeInTheDocument()
    expect(screen.getByTestId("item")).toBeInTheDocument()
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it("keeps a cell's DOM node when the list is reordered (keys, not positions)", () => {
    const { rerender } = render(grid())
    const first = screen.getAllByTestId("cell")[0]
    rerender(grid({ items: [rows[2], rows[0], rows[1]] }))
    expect(screen.getAllByTestId("cell")[1]).toBe(first)
  })
})

describe("one of loading, error, empty, items", () => {
  const gridEl = () => region().firstElementChild as HTMLElement | null

  it("shows loading before everything else, as three 16:9 skeletons in the same grid classes", () => {
    render(grid({ loading: true, error: <p>err</p>, empty: <p>none</p> }))
    expect(screen.queryByText("err")).toBeNull()
    expect(screen.queryByText("none")).toBeNull()
    expect(screen.queryAllByTestId("cell")).toHaveLength(0)
    expect(gridEl()).toHaveClass(...COLUMN_PRESETS.library.className.split(" "))
    const skeletons = region().querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons).toHaveLength(3)
    expect(skeletons[0]).toHaveClass("aspect-video", "w-full")
  })

  it("takes skeletonCount and renderSkeleton", () => {
    render(grid({ loading: true, skeletonCount: 5, renderSkeleton: (i) => <u data-testid="sk">{i}</u> }))
    expect(screen.getAllByTestId("sk").map((s) => s.textContent)).toEqual(["0", "1", "2", "3", "4"])
  })

  it("shows the error before empty and items", () => {
    render(grid({ error: <p>err</p>, empty: <p>none</p> }))
    expect(screen.getByText("err")).toBeInTheDocument()
    expect(screen.queryByText("none")).toBeNull()
    expect(screen.queryAllByTestId("cell")).toHaveLength(0)
    expect(region().firstElementChild?.tagName).toBe("P")
  })

  it("shows empty before items", () => {
    render(grid({ empty: <p>none</p> }))
    expect(screen.getByText("none")).toBeInTheDocument()
    expect(screen.queryAllByTestId("cell")).toHaveLength(0)
  })

  it("shows the items when none of the three is set", () => {
    render(grid())
    expect(screen.getAllByTestId("cell")).toHaveLength(3)
  })

  it("keeps the same scroll region element across every state", () => {
    const { rerender } = render(grid({ loading: true }))
    const el = region()
    rerender(grid({ error: <p>err</p> }))
    rerender(grid({ empty: <p>none</p> }))
    rerender(grid())
    expect(region()).toBe(el)
  })
})

describe("the grid and scroll region elements", () => {
  it("puts the preset's classes on the grid and appends gridClassName", () => {
    render(grid({ gridClassName: "group/x" }))
    const g = region().firstElementChild as HTMLElement
    expect(g.className).toBe(`${COLUMN_PRESETS.library.className} group/x`)
  })

  it("takes the other preset", () => {
    render(grid({ columns: "gallery" }))
    expect((region().firstElementChild as HTMLElement).className).toBe(COLUMN_PRESETS.gallery.className)
  })

  it("is one scroll region with today's classes, a test id and focus-region marker, and no nested scroller", () => {
    const { container } = render(grid({ className: "extra" }))
    expect(container.firstElementChild).toBe(region())
    expect(region().className).toBe(
      "-my-1 -ml-1 -mr-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1 pl-1 pr-2 [scrollbar-gutter:stable] extra",
    )
    expect(region()).toHaveAttribute("data-focus-region")
    expect(container.querySelectorAll('[class*="overflow-y-auto"]')).toHaveLength(1)
  })

  it("has no test id unless given one", () => {
    const { container } = render(grid({ scrollTestId: undefined }))
    expect(container.firstElementChild).not.toHaveAttribute("data-testid")
  })
})

describe("resetKey", () => {
  const withKey = (key?: string, over: Partial<ResponsiveGridProps<Row>> = {}) => grid({ resetKey: key, ...over })

  it("returns the region to the top when the key changes", () => {
    const { rerender } = render(withKey("a"))
    region().scrollTop = 200
    rerender(withKey("b"))
    expect(region().scrollTop).toBe(0)
  })

  it("keeps the scroll on a re-render with the same key, also with new items (a refetch)", () => {
    const { rerender } = render(withKey("a"))
    region().scrollTop = 200
    rerender(withKey("a", { items: [rows[0]] }))
    expect(region().scrollTop).toBe(200)
    rerender(withKey("a", { loading: true }))
    expect(region().scrollTop).toBe(200)
  })

  it("does nothing on mount", () => {
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")
    const writes = vi.fn()
    Object.defineProperty(Element.prototype, "scrollTop", { configurable: true, get: () => 0, set: writes })
    try {
      render(withKey("a"))
    } finally {
      if (original) Object.defineProperty(Element.prototype, "scrollTop", original)
      else delete (Element.prototype as { scrollTop?: number }).scrollTop
    }
    expect(writes).not.toHaveBeenCalled()
  })

  it("does nothing on mount under StrictMode either", () => {
    render(
      <StrictMode>
        {withKey("a")}
      </StrictMode>,
    )
    region().scrollTop = 120
    expect(region().scrollTop).toBe(120)
  })
})

describe("gridComponent (the selecting invariant)", () => {
  // Stands in for LibraryCardGrid: its own state changes re-render it, never the cells it was handed.
  let toggle!: () => void
  function Wrapper({ className, children }: GridElementProps) {
    const [selecting, set] = useState(false)
    toggle = () => set((s) => !s)
    return (
      <div className={className} data-selecting={selecting ? "" : undefined} data-testid="wrapper">
        {children}
      </div>
    )
  }

  it("renders the grid element itself, with the preset classes and the cells as its children", () => {
    render(grid({ gridComponent: Wrapper, gridClassName: "group/x" }))
    const w = screen.getByTestId("wrapper")
    expect(w.parentElement).toBe(region())
    expect(w.className).toBe(`${COLUMN_PRESETS.library.className} group/x`)
    expect(w.children).toHaveLength(3)
  })

  it("re-renders the wrapper alone when its state changes: no cell renders, DOM nodes stay", () => {
    const renders = vi.fn()
    const Cell = ({ r }: { r: Row }) => {
      renders(r.id)
      return <span data-testid="cell">{r.label}</span>
    }
    const Plain = (r: Row) => <Cell r={r} />
    render(grid({ gridComponent: Wrapper, renderItem: Plain }))
    const nodes = screen.getAllByTestId("cell")
    renders.mockClear()
    act(() => toggle())
    expect(screen.getByTestId("wrapper")).toHaveAttribute("data-selecting")
    expect(renders).not.toHaveBeenCalled()
    act(() => toggle())
    expect(screen.getByTestId("wrapper")).not.toHaveAttribute("data-selecting")
    expect(renders).not.toHaveBeenCalled()
    expect(screen.getAllByTestId("cell")).toEqual(nodes)
  })

  it("with stable props, a parent re-render for another reason calls renderItem again for nothing", () => {
    const rend = vi.fn(renderRow)
    function Parent({ children }: { children?: ReactNode }) {
      const [n, set] = useState(0)
      return (
        <>
          <button onClick={() => set(n + 1)}>bump {n}</button>
          {children}
          <ResponsiveGrid items={rows} getKey={getKey} renderItem={rend} columns="library" />
        </>
      )
    }
    render(<Parent />)
    rend.mockClear()
    act(() => screen.getByRole("button").click())
    expect(rend).not.toHaveBeenCalled()
  })
})

import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ResponsiveGrid } from "@/components/responsive-grid"
import { TooltipProvider } from "@/components/ui/tooltip"
import { installLayoutMock } from "@/test/layoutMock"
import type { LayoutMock } from "@/test/layoutMock"
import { mockFetch } from "@/test/mockApi"
import type { LibraryItem } from "@/types/api"
import { LibraryCard, LibraryCardGrid } from "./LibraryCard"
import { LibraryCardsProvider } from "./LibraryCardsProvider"
import { RevealAllProvider } from "./RevealAllContext"
import { SelectionProvider, useSelection } from "./SelectionContext"

// The windowed Library grid: the same wiring as LibraryGrid, 1,000 items.
const thumbRenders = vi.hoisted(() => new Map<number, number>())
vi.mock("@/components/BlurredThumbnail", () => ({
  BlurredThumbnail: ({ src }: { src: string }) => {
    const id = Number(/t(\d+)\.jpg/.exec(src)?.[1])
    thumbRenders.set(id, (thumbRenders.get(id) ?? 0) + 1)
    return <img src={src} alt="" />
  },
}))

let layout: LayoutMock
beforeEach(() => {
  thumbRenders.clear()
  mockFetch((url) => (url.endsWith("/settings") ? { status: 200, body: { libraryMode: "manage" } } : { status: 200, body: [] }))
  layout = installLayoutMock({ viewportWidth: 1280, viewportHeight: 600, rowHeight: () => 280 })
})
afterEach(() => {
  layout.restore()
})

const item = (id: number) =>
  ({ id, title: `Item ${id}`, filename: `f${id}.mp4`, path: `m/f${id}.mp4`, mediaType: "video", status: "completed", originalUrl: "https://x/y", thumbnail: `t${id}.jpg`, blurred: false, tags: [], activeDownloadId: null }) as unknown as LibraryItem
const items = Array.from({ length: 1000 }, (_, i) => item(i + 1))
const getKey = (i: LibraryItem) => i.id
const renderItem = (i: LibraryItem) => <LibraryCard item={i} />

let selection!: ReturnType<typeof useSelection>
function Harness() {
  selection = useSelection()
  return (
    <LibraryCardsProvider items={items}>
      <ResponsiveGrid items={items} getKey={getKey} renderItem={renderItem} columns="library" virtualize gridClassName="group/lib-grid" gridComponent={LibraryCardGrid} scrollTestId="scroll" />
    </LibraryCardsProvider>
  )
}

function renderGrid() {
  const router = createMemoryRouter(
    [
      {
        path: "/lib",
        element: (
          <RevealAllProvider>
            <SelectionProvider>
              <Harness />
            </SelectionProvider>
          </RevealAllProvider>
        ),
      },
    ],
    { initialEntries: ["/lib"] },
  )
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))))
const mountedCards = (c: HTMLElement) => c.querySelectorAll('[data-slot="card"]').length

describe("the Library grid, windowed", () => {
  it("mounts a bounded number of cards and turns content-visibility off for them", async () => {
    const { container } = renderGrid()
    await settle()
    expect(mountedCards(container)).toBeGreaterThan(0)
    expect(mountedCards(container)).toBeLessThan(60)
    expect(container.querySelector('[class~="group/lib-grid"]')!.className).toContain("[&_[data-slot=card]]:[content-visibility:visible]")
  })

  it("starting and clearing a selection sets data-selecting on the wrapper and re-renders only the ticked card", async () => {
    const { container } = renderGrid()
    await settle()
    const grid = container.querySelector('[class~="group/lib-grid"]')!
    expect(grid.hasAttribute("data-selecting")).toBe(false)
    thumbRenders.clear()
    await userEvent.click(screen.getAllByRole("checkbox", { name: /^Select / })[0])
    expect(grid.hasAttribute("data-selecting")).toBe(true)
    expect([...thumbRenders.keys()]).toEqual([1])
    thumbRenders.clear()
    await userEvent.click(screen.getAllByRole("checkbox", { name: /^Select / })[0])
    expect(grid.hasAttribute("data-selecting")).toBe(false)
    expect([...thumbRenders.keys()]).toEqual([1])
  })

  it("select all covers the cards that are not mounted, and a ticked card keeps its state when it scrolls away and back", async () => {
    const { container } = renderGrid()
    await settle()
    act(() => selection.selectItems(items))
    expect(selection.approxCount).toBe(1000)
    expect(mountedCards(container)).toBeLessThan(60)
    // a card that was not mounted shows as selected once it is
    act(() => layout.scrollTo(screen.getByTestId("scroll"), 280 * 100))
    const boxes = screen.getAllByRole("checkbox", { name: /^Select / })
    expect(boxes.length).toBeGreaterThan(0)
    expect(boxes.every((b) => b.getAttribute("aria-checked") === "true" || (b as HTMLInputElement).checked)).toBe(true)
    act(() => selection.clear())
    expect(selection.approxCount).toBe(0)
  })
})

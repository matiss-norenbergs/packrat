import { act, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import { LibraryFolderView } from "./LibraryFolderView"
import { LibrarySortProvider } from "./LibrarySortContext"
import { RevealAllProvider } from "./RevealAllContext"
import { SelectionProvider } from "./SelectionContext"

// Render counts of the Folders view's mixed grid (folder tiles + cards) through the ResponsiveGrid seam.
const thumbRenders = vi.hoisted(() => new Map<number, number>())
const tileRenders = vi.hoisted(() => new Map<number, number>())
vi.mock("@/components/BlurredThumbnail", () => ({
  BlurredThumbnail: ({ src }: { src: string }) => {
    const id = Number(/t(\d+)\.jpg/.exec(src)?.[1])
    thumbRenders.set(id, (thumbRenders.get(id) ?? 0) + 1)
    return <img src={src} alt="" />
  },
}))
vi.mock("./CollectionFolderTile", async () => {
  const actual = await vi.importActual<typeof import("./CollectionFolderTile")>("./CollectionFolderTile")
  return {
    CollectionFolderTile: (props: Parameters<typeof actual.CollectionFolderTile>[0]) => {
      tileRenders.set(props.node.id, (tileRenders.get(props.node.id) ?? 0) + 1)
      return actual.CollectionFolderTile(props)
    },
  }
})

const item = (id: number) => ({ id, title: `Item ${id}`, filename: `f${id}.mp4`, path: `m/f${id}.mp4`, mediaType: "video", status: "completed", originalUrl: "https://x/y", thumbnail: `t${id}.jpg`, blurred: false, tags: [], activeDownloadId: null })
const folder = (id: number, name: string) => ({ id, name, parentId: null, path: name, createdAt: "2026-01-01T00:00:00Z", itemCount: 0, isPrivate: false })

beforeEach(() => {
  thumbRenders.clear()
  tileRenders.clear()
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  mockFetch((url) => {
    if (url.includes("/library?")) return { status: 200, body: { items: [1, 2, 3, 4].map(item), total: 4 } }
    if (url.endsWith("/settings")) return { status: 200, body: { libraryMode: "manage" } }
    if (url.endsWith("/collections")) return { status: 200, body: [folder(10, "Alpha"), folder(11, "Beta")] }
    if (url.endsWith("/auth/table-layouts")) return { status: 200, body: { layouts: {} } }
    return { status: 200, body: [] }
  })
})

describe("folder view render counts", () => {
  it("renders the folder tiles first, then the cards, all in one grid", async () => {
    renderWithProviders(
      <TooltipProvider>
        <LibrarySortProvider>
          <RevealAllProvider>
            <SelectionProvider>
              <LibraryFolderView />
            </SelectionProvider>
          </RevealAllProvider>
        </LibrarySortProvider>
      </TooltipProvider>,
    )
    await screen.findByText("Item 1")
    const grid = screen.getByTestId("library-scroll").firstElementChild!
    expect(grid.className).toContain("group/lib-grid")
    expect(grid.children).toHaveLength(6)
    expect(grid.children[0]).toHaveTextContent("Alpha")
    expect(grid.children[1]).toHaveTextContent("Beta")
    expect(grid.children[2]).toHaveTextContent("Item 1")
  })

  it("starting and clearing a selection re-renders no card; ticking another re-renders only that card and no tile", async () => {
    renderWithProviders(
      <TooltipProvider>
        <LibrarySortProvider>
          <RevealAllProvider>
            <SelectionProvider>
              <LibraryFolderView />
            </SelectionProvider>
          </RevealAllProvider>
        </LibrarySortProvider>
      </TooltipProvider>,
    )
    await screen.findByText("Item 1")
    await act(async () => void (await new Promise((r) => setTimeout(r, 60))))
    const user = userEvent.setup()
    const boxes = () => screen.getAllByRole("checkbox", { name: /^Select Item/ })
    tileRenders.clear()
    thumbRenders.clear()
    await user.click(boxes()[0])
    expect([...thumbRenders.keys()]).toEqual([1]) // only the ticked card
    // A tile subscribes to the active flag itself (its checkbox shows while selecting), once per tile, as before the grid seam.
    expect([...tileRenders.values()]).toEqual([1, 1])
    tileRenders.clear()
    thumbRenders.clear()
    await user.click(boxes()[2])
    expect([...thumbRenders.keys()]).toEqual([3])
    expect(tileRenders.size).toBe(0)
    thumbRenders.clear()
    await user.click(boxes()[0])
    await user.click(boxes()[2])
    expect([...thumbRenders.keys()].sort()).toEqual([1, 3])
    expect([...tileRenders.values()]).toEqual([1, 1]) // clearing: the same two tile renders
  })
})

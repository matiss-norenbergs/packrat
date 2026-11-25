import { useState } from "react"
import { RouterProvider, createMemoryRouter, useNavigate } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockFetch } from "@/test/mockApi"
import type { LibraryItem } from "@/types/api"
import { LibraryCard, LibraryCardGrid } from "./LibraryCard"
import { LibraryCardsProvider } from "./LibraryCardsProvider"
import { LibraryItemActionsMenu } from "./LibraryItemActionsMenu"
import { useLibraryItemActions } from "./libraryItemActions"
import { RevealAllProvider, useRevealActions } from "./RevealAllContext"
import { SelectionProvider } from "./SelectionContext"

vi.mock("./libraryItemActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./libraryItemActions")>()
  return { ...actual, useLibraryItemActions: vi.fn(actual.useLibraryItemActions) }
})

// Counts the renders of each card's thumbnail (one per card render), keyed by item id.
const thumbRenders = vi.hoisted(() => new Map<number, number>())
vi.mock("@/components/BlurredThumbnail", () => ({
  BlurredThumbnail: ({ src }: { src: string }) => {
    const id = Number(/t(\d+)\.jpg/.exec(src)?.[1])
    thumbRenders.set(id, (thumbRenders.get(id) ?? 0) + 1)
    return <img src={src} alt="" />
  },
}))

beforeEach(() => {
  thumbRenders.clear()
  vi.mocked(useLibraryItemActions).mockClear()
  mockFetch((url) => (url.endsWith("/settings") ? { status: 200, body: { libraryMode: "manage" } } : { status: 200, body: [] }))
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const item = (id: number, over: Partial<LibraryItem> = {}) =>
  ({ id, title: `Item ${id}`, filename: `f${id}.mp4`, path: `m/f${id}.mp4`, mediaType: "video", status: "completed", originalUrl: "https://x/y", thumbnail: `t${id}.jpg`, blurred: false, tags: [], activeDownloadId: null, ...over }) as LibraryItem
const make = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1))
const four = make(4)

let setItems!: (items: LibraryItem[]) => void
let reveal!: ReturnType<typeof useRevealActions>
let navigate!: ReturnType<typeof useNavigate>

function Harness({ initial }: { initial: LibraryItem[] }) {
  const [items, set] = useState(initial)
  setItems = set
  reveal = useRevealActions()
  navigate = useNavigate()
  return (
    <LibraryCardsProvider items={items}>
      <LibraryCardGrid>
        {items.map((i) => (
          <LibraryCard key={i.id} item={i} />
        ))}
      </LibraryCardGrid>
    </LibraryCardsProvider>
  )
}

function renderGrid(items: LibraryItem[]) {
  const router = createMemoryRouter(
    [
      {
        path: "/lib",
        element: (
          <RevealAllProvider>
            <SelectionProvider>
              <Harness initial={items} />
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

// Lets the settings / tags / artists queries answer, which re-renders the cards once (the masks and the card mode change).
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))))
const triggers = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]')]

describe("the grid's shared actions host", () => {
  it("mounts one host for any number of cards, none bound to an item", () => {
    const { container } = renderGrid(make(40))
    expect(triggers(container)).toHaveLength(40)
    const calls = vi.mocked(useLibraryItemActions).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every(([fixed]) => fixed === undefined)).toBe(true)
  })

  it("opens the dialog for the clicked card's item, follows a refetch and survives the item leaving the page", async () => {
    const { container } = renderGrid(make(5))
    await userEvent.click(triggers(container)[1])
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }))
    expect(await screen.findByText('Delete "Item 2"?')).toBeTruthy()

    act(() => setItems(make(5).map((i) => (i.id === 2 ? { ...i, title: "Renamed" } : i))))
    expect(await screen.findByText('Delete "Renamed"?')).toBeTruthy()

    act(() => setItems(make(5).filter((i) => i.id !== 2)))
    expect(screen.getByText('Delete "Renamed"?')).toBeTruthy()
    expect(within(container).queryByText("Item 2")).toBeNull()
  })

  it("hides the menu during a selection through CSS, without unmounting or re-rendering anything", async () => {
    const { container } = renderGrid(make(3))
    await settle()
    const trigger = triggers(container)[0]
    const grid = container.querySelector('[class~="group/lib-grid"]')!
    expect(grid.hasAttribute("data-selecting")).toBe(false)
    // The wrapper's variant hides it (display: none, so it also leaves the tab order) once the grid says "selecting".
    expect(trigger.parentElement!.className).toContain("group-data-[selecting]/lib-grid:hidden")
    thumbRenders.clear()
    await userEvent.click(screen.getAllByRole("checkbox", { name: "Select" })[0])
    expect(grid.hasAttribute("data-selecting")).toBe(true)
    expect(triggers(container)[0]).toBe(trigger)
    expect(trigger.isConnected).toBe(true)
    // starting the selection re-rendered only the ticked card
    expect([...thumbRenders.keys()]).toEqual([1])
    thumbRenders.clear()
    await userEvent.click(screen.getAllByRole("checkbox", { name: "Select" })[0])
    expect(grid.hasAttribute("data-selecting")).toBe(false)
    expect(triggers(container)[0]).toBe(trigger)
    expect([...thumbRenders.keys()]).toEqual([1])
  })
})

describe("card render counts", () => {
  const rendered = () => [...thumbRenders.keys()].sort((a, b) => a - b)

  it("ticking one more checkbox re-renders only that card", async () => {
    renderGrid(make(6))
    await settle()
    await userEvent.click(screen.getAllByRole("checkbox", { name: "Select" })[0])
    thumbRenders.clear()
    await userEvent.click(screen.getAllByRole("checkbox", { name: "Select" })[2])
    expect(rendered()).toEqual([3])
  })

  it("revealing one item re-renders only that card", async () => {
    renderGrid(make(6))
    await settle()
    thumbRenders.clear()
    act(() => reveal.toggleItem(4))
    expect(rendered()).toEqual([4])
  })

  it("a URL / filter change re-renders no unchanged card", async () => {
    renderGrid(make(6))
    await settle()
    thumbRenders.clear()
    await act(async () => {
      await navigate("/lib?q=x")
    })
    expect(thumbRenders.size).toBe(0)
  })

  it("a changed item re-renders just its card", async () => {
    renderGrid(four)
    await settle()
    thumbRenders.clear()
    act(() => setItems(four.map((i) => (i.id === 3 ? { ...i, title: "New" } : i))))
    expect(rendered()).toEqual([3])
  })
})

describe("the standalone menu (item page)", () => {
  it("keeps its own host and opens its dialog", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LibraryItemActionsMenu item={item(7)} />
      </QueryClientProvider>,
    )
    expect(vi.mocked(useLibraryItemActions).mock.calls.some(([fixed]) => fixed?.id === 7)).toBe(true)
    await userEvent.click(screen.getByRole("button"))
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }))
    await waitFor(() => expect(screen.getByText('Delete "Item 7"?')).toBeTruthy())
  })
})

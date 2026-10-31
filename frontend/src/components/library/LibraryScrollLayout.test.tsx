import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useSearchParams } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LibraryPage } from "@/pages/LibraryPage"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import { LibraryFolderView } from "./LibraryFolderView"
import { LibraryGrid } from "./LibraryGrid"
import { LibraryScrollView } from "./LibraryScrollView"
import { LibrarySortProvider } from "./LibrarySortContext"
import { RevealAllProvider } from "./RevealAllContext"
import { SelectionProvider, useSelection } from "./SelectionContext"
import { useLibrarySort } from "@/hooks/useLibrarySort"

// jsdom has no layout: heights, overflow and actual scrolling are not asserted here; they are measured in the browser
// (see the PR). What these tests pin is the structure: who is inside the scroll region and who is a fixed sibling.

interface Serve {
  settings?: Record<string, unknown>
  total?: number
  libraryStatus?: number
  items?: object[]
}

function serve({ settings = {}, total = 60, libraryStatus = 200, items = [] }: Serve = {}) {
  return mockFetch((url) => {
    if (url.includes("/library?")) return libraryStatus === 200 ? { status: 200, body: { items, total } } : { status: libraryStatus, body: { error: "boom" } }
    if (url.endsWith("/settings")) return { status: 200, body: { libraryPaginationEnabled: true, libraryPageSize: 24, ...settings } }
    if (url.endsWith("/auth/table-layouts")) return { status: 200, body: { layouts: {} } }
    if (url.endsWith("/collections") || url.endsWith("/tags") || url.endsWith("/artists") || url.includes("/compare")) return { status: 200, body: [] }
    if (url.endsWith("/library/facets")) return { status: 200, body: { years: [] } }
    return { status: 200, body: {} }
  })
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const region = () => screen.getByTestId("library-scroll")
const footerCount = () => screen.queryByText(/^\d+ items?$/)

function renderView(view: React.ReactNode, route = "/") {
  return renderWithProviders(
    <TooltipProvider>
      <LibrarySortProvider>
        <RevealAllProvider>
          <SelectionProvider>{view}</SelectionProvider>
        </RevealAllProvider>
      </LibrarySortProvider>
    </TooltipProvider>,
    route,
  )
}

describe.each([
  ["grid", <LibraryGrid key="g" />],
  ["folder view", <LibraryFolderView key="f" />],
])("%s: the cards scroll, the footer does not", (_name, view) => {
  it("puts the pagination footer next to the scroll region, not inside it, when pagination is on", async () => {
    serve()
    renderView(view)
    const count = await screen.findByText("60 items")
    expect(region()).not.toContainElement(count)
    expect(region()).not.toContainElement(screen.getByRole("button", { name: "Next" }))
    // The shell is one flex column: [header] region footer.
    const shell = region().parentElement!
    expect(shell).toHaveClass("flex", "min-h-0", "flex-1", "flex-col")
    expect(shell).toContainElement(count)
    expect(region().nextElementSibling).toContainElement(count)
    expect(region()).toHaveClass("min-h-0", "flex-1", "overflow-y-auto")
  })

  it("renders no footer when pagination is off, and the region is the last child", async () => {
    serve({ settings: { libraryPaginationEnabled: false } })
    renderView(view)
    await screen.findByTestId("library-scroll")
    await new Promise((r) => setTimeout(r, 100))
    expect(footerCount()).toBeNull()
    expect(region().nextElementSibling).toBeNull()
  })

  it("shows the error inside the region and no footer", async () => {
    serve({ libraryStatus: 500 })
    renderView(view)
    expect(await within(region()).findByText(/Failed to load library/)).toBeInTheDocument()
    expect(footerCount()).toBeNull()
  })

  it("shows the empty state inside the region and no footer", async () => {
    serve({ total: 0 })
    renderView(view)
    const text = await screen.findByText(/Nothing here yet|This collection is empty/)
    expect(region()).toContainElement(text)
    expect(footerCount()).toBeNull()
  })

  it("shows the loading skeletons inside the region", () => {
    serve()
    renderView(view)
    expect(region().querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })
})

describe("folder view: the breadcrumb", () => {
  it("is fixed above the scroll region, with the folder tiles and cards inside it", async () => {
    serve()
    renderView(<LibraryFolderView />)
    const root = await screen.findByRole("button", { name: "Root" })
    const crumb = root.parentElement!
    expect(region()).not.toContainElement(crumb)
    expect(crumb).toHaveClass("shrink-0")
    expect(crumb.nextElementSibling).toBe(region())
  })
})

describe("LibraryPage shell", () => {
  const page = () =>
    renderWithProviders(
      <TooltipProvider>
        <LibrarySortProvider>
          <RevealAllProvider>
            <LibraryPage />
          </RevealAllProvider>
        </LibrarySortProvider>
      </TooltipProvider>,
      "/library",
    )

  it.each(["grid", "folders"])("%s: one flex column, a fixed non-sticky toolbar row and no DataTable", async (libraryView) => {
    serve({ settings: { libraryView } })
    const { container } = page()
    await screen.findByTestId("library-scroll")
    const shell = container.firstElementChild as HTMLElement
    expect(shell).toHaveClass("flex", "h-full", "min-h-0", "flex-col", "gap-6")
    expect(screen.getByRole("heading", { name: "Library" })).toHaveClass("shrink-0")
    const bar = screen.getByRole("heading", { name: "Library" }).nextElementSibling as HTMLElement
    expect(bar).toHaveClass("shrink-0", "border-b")
    expect(bar).toContainElement(screen.getByRole("button", { name: /Filters & Sort/ }))
    expect(container.querySelector(".sticky")).toBeNull()
    expect(container.querySelector("[class*='-top-']")).toBeNull()
    expect(screen.queryByRole("table")).toBeNull()
    expect(bar.nextElementSibling).toContainElement(region())
  })

  it("list: still the DataTable branch, without the cards scroll region", async () => {
    const item = { id: 1, title: "Title 1", filename: "a.mp4", path: "m/a.mp4", mediaType: "video", tags: [], downloadedAt: "2026-03-05T10:00:00Z" }
    serve({ settings: { libraryView: "list" }, items: [item], total: 1 })
    const { container } = page()
    expect(await screen.findByRole("table")).toBeInTheDocument()
    expect(screen.queryByTestId("library-scroll")).toBeNull()
    expect(container.firstElementChild).toHaveClass("flex", "h-full", "min-h-0", "flex-col", "gap-6")
    expect(screen.getByPlaceholderText("Search library…")).toBeInTheDocument()
  })
})

describe("LibraryScrollView: resetKey", () => {
  const view = (key: string | undefined, children: React.ReactNode = "cards") => (
    <LibraryScrollView resetKey={key}>{children}</LibraryScrollView>
  )

  it("returns the region to the top when the key changes", () => {
    const { rerender } = render(view("a"))
    region().scrollTop = 200
    rerender(view("b"))
    expect(region().scrollTop).toBe(0)
  })

  it("keeps the scroll on a re-render with the same key, also with new children (a refetch)", () => {
    const { rerender } = render(view("a", "old cards"))
    region().scrollTop = 200
    rerender(view("a", "old cards"))
    expect(region().scrollTop).toBe(200)
    rerender(view("a", "refetched cards"))
    expect(region().scrollTop).toBe(200)
  })

  it("does nothing on mount", () => {
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")
    const writes = vi.fn()
    Object.defineProperty(Element.prototype, "scrollTop", { configurable: true, get: () => 0, set: writes })
    try {
      render(view("a"))
    } finally {
      if (original) Object.defineProperty(Element.prototype, "scrollTop", original)
      else delete (Element.prototype as { scrollTop?: number }).scrollTop
    }
    expect(writes).not.toHaveBeenCalled()
  })
})

// Stands in for the toolbar / sort dialog / a card's selection box.
function Controls() {
  const [, setParams] = useSearchParams()
  const { setSort } = useLibrarySort()
  const { toggleCollection } = useSelection()
  return (
    <>
      <button type="button" onClick={() => setParams((p) => ({ ...Object.fromEntries(p), q: "abc" }))}>search</button>
      <button type="button" onClick={() => setSort({ key: "title", dir: "asc" })}>sort</button>
      <button type="button" onClick={() => toggleCollection(77, 3)}>select</button>
    </>
  )
}

describe.each([
  ["grid", <LibraryGrid key="g" />, "/"],
  ["folder view", <LibraryFolderView key="f" />, "/?collection=7"],
])("%s: the region goes back to the top", (_name, view, route) => {
  async function scrolled() {
    serve()
    renderView(
      <>
        <Controls />
        {view}
      </>,
      route,
    )
    await screen.findByText("60 items")
    region().scrollTop = 200
  }

  it("on the next page", async () => {
    await scrolled()
    await userEvent.setup().click(screen.getByRole("button", { name: "Next" }))
    await screen.findByRole("button", { name: "2", current: "page" })
    expect(region().scrollTop).toBe(0)
  })

  it("on a new search and a new sort", async () => {
    const user = userEvent.setup()
    await scrolled()
    await user.click(screen.getByRole("button", { name: "search" }))
    await screen.findByText("60 items")
    expect(region().scrollTop).toBe(0)
    region().scrollTop = 200
    await user.click(screen.getByRole("button", { name: "sort" }))
    await screen.findByText("60 items")
    expect(region().scrollTop).toBe(0)
  })

  it("not on a selection change or a refetch of the same page", async () => {
    const user = userEvent.setup()
    await scrolled()
    await user.click(screen.getByRole("button", { name: "select" }))
    expect(region().scrollTop).toBe(200)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    fireEvent.focus(window)
    expect(region().scrollTop).toBe(200)
  })
})

describe("folder view: leaving the folder", () => {
  it("clicking Root goes back to the top", async () => {
    serve()
    renderView(<LibraryFolderView />, "/?collection=7")
    await screen.findByText("60 items")
    region().scrollTop = 200
    await userEvent.setup().click(screen.getByRole("button", { name: "Root" }))
    await screen.findByText("60 items")
    expect(region().scrollTop).toBe(0)
  })
})

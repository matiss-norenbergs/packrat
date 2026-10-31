import { cleanup, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LibraryPage } from "@/pages/LibraryPage"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import { LibraryFolderView } from "./LibraryFolderView"
import { LibraryGrid } from "./LibraryGrid"
import { LibrarySortProvider } from "./LibrarySortContext"
import { RevealAllProvider } from "./RevealAllContext"
import { SelectionProvider } from "./SelectionContext"

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

function renderView(view: React.ReactNode) {
  return renderWithProviders(
    <TooltipProvider>
      <LibrarySortProvider>
        <RevealAllProvider>
          <SelectionProvider>{view}</SelectionProvider>
        </RevealAllProvider>
      </LibrarySortProvider>
    </TooltipProvider>,
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

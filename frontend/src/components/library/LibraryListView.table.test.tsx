import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, useLocation, useSearchParams } from "react-router-dom"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useLibrarySort } from "@/hooks/useLibrarySort"
import { hashText } from "@/lib/utils"
import { mockFetch } from "@/test/mockApi"
import type { LibraryItem, TableLayouts } from "@/types/api"
import { LibraryListView } from "./LibraryListView"
import { LibrarySortProvider } from "./LibrarySortContext"
import { LibraryToolbar } from "./LibraryToolbar"
import { RevealAllProvider } from "./RevealAllContext"
import { SelectionProvider, useSelection } from "./SelectionContext"

// jsdom has no PointerEvent (the column resize handle uses pointer events).
beforeAll(() => {
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number
      pointerType: string
      constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 1
        this.pointerType = init.pointerType ?? "mouse"
      }
    }
    window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent
  }
})

beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const PAGE_SIZE = 3

function item(id: number, over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id,
    title: `Title ${id}`,
    filename: `file${id}.mp4`,
    path: `media/file${id}.mp4`,
    collectionId: null,
    collectionName: null,
    artistName: null,
    uploader: null,
    year: null,
    duration: 3725,
    seasonNumber: null,
    sequenceNumber: null,
    fileSizeBytes: null,
    downloadedAt: "2026-03-05T10:00:00Z",
    mediaType: "video",
    thumbnail: null,
    thumbnailSmallPath: null,
    blurred: false,
    tags: [],
    ...over,
  } as LibraryItem
}

interface ServeOptions {
  settings?: Record<string, unknown>
  layouts?: TableLayouts
  /** Replaces the library answer (an error status, a delay…). */
  library?: (params: URLSearchParams) => { status: number; body?: unknown }
}

// Behaves like the server for what matters here: slices by page / pageSize and reports the total. Order is not sorted:
// the table never sorts, the tests read the request's sort parameters instead.
function serve(all: LibraryItem[], opts: ServeOptions = {}) {
  let layouts: TableLayouts = opts.layouts ?? {}
  return mockFetch((url, init) => {
    const method = init?.method ?? "GET"
    if (url.endsWith("/auth/table-layouts")) return { status: 200, body: { layouts } }
    if (url.includes("/auth/table-layouts/")) {
      if (method === "PUT") {
        layouts = { ...layouts, library: JSON.parse(init.body as string) }
        return { status: 200, body: layouts.library }
      }
      layouts = {}
      return { status: 204 }
    }
    if (url.includes("/library?")) {
      const params = new URL(url, "http://x").searchParams
      if (opts.library) return opts.library(params)
      const size = Number(params.get("pageSize") ?? all.length)
      const page = Number(params.get("page") ?? "1")
      return { status: 200, body: { items: all.slice((page - 1) * size, page * size), total: all.length } }
    }
    if (url.endsWith("/settings")) return { status: 200, body: { libraryView: "list", libraryMode: "manage", libraryPaginationEnabled: true, libraryPageSize: PAGE_SIZE, ...opts.settings } }
    if (url.endsWith("/library/facets")) return { status: 200, body: { years: [] } }
    if (url.endsWith("/collections") || url.endsWith("/tags") || url.endsWith("/artists") || url.includes("/compare")) return { status: 200, body: [] }
    return { status: 200, body: {} }
  })
}

type Fetch = ReturnType<typeof mockFetch>
const libraryParams = (fn: Fetch) => fn.mock.calls.filter(([url]) => url.includes("/library?")).map(([url]) => new URL(url, "http://x").searchParams)
const settle = () => new Promise((r) => setTimeout(r, 80))

// Stands in for the toolbar's summary (approxCount) and for what other views read from the shared state.
function Probe() {
  const { approxCount, toggleCollection, selectedCollectionIds } = useSelection()
  const { sort, layout, setSort } = useLibrarySort()
  const location = useLocation()
  const [params] = useSearchParams()
  return (
    <div>
      <output data-testid="q">{params.get("q") ?? ""}</output>
      <output data-testid="approx">{approxCount}</output>
      <output data-testid="collections">{selectedCollectionIds.size}</output>
      <output data-testid="sort">{`${sort.key}:${sort.dir}`}</output>
      <output data-testid="layout">{JSON.stringify(layout)}</output>
      <output data-testid="location">{location.pathname}</output>
      <button type="button" onClick={() => toggleCollection(77, 10)}>
        pick collection
      </button>
      <button type="button" onClick={() => setSort({ key: "filename", dir: "asc" })}>
        sort by filename
      </button>
    </div>
  )
}

function renderList(initialEntries = ["/library"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <TooltipProvider>
          <LibrarySortProvider>
            <RevealAllProvider>
              <SelectionProvider>
                <Probe />
                <LibraryListView />
              </SelectionProvider>
            </RevealAllProvider>
          </LibrarySortProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const ITEMS = [1, 2, 3, 4, 5, 6, 7].map((i) => item(i))
const row = (title: string) => screen.getByText(title).closest("tr")!
const checkbox = (title: string) => screen.getByRole("checkbox", { name: `Select ${title}` })
const press = (title: string, init?: object) => {
  fireEvent.mouseDown(row(title), init)
  fireEvent.mouseUp(window)
}
const isSelected = (title: string) => row(title).getAttribute("data-state") === "selected"
const footer = () => screen.getByText(/^\d+ items?/).textContent
// Read from the DOM: while a Radix menu is open everything outside it is aria-hidden.
const headers = () => Array.from(document.querySelectorAll("th:not([aria-hidden])")).map((h) => h.textContent)
const approx = () => screen.getByTestId("approx").textContent
const header = (name: string) => screen.getByRole("columnheader", { name })
const sortButton = (name: string) => within(header(name)).getByRole("button")
const colWidths = () => Array.from(document.querySelectorAll("col")).map((c) => (c as HTMLElement).style.width)

async function ready(title = "Title 1") {
  await screen.findByText(title)
}

describe("LibraryListView on DataTable: columns", () => {
  it("shows the default columns and hides the optional ones", async () => {
    serve(ITEMS)
    renderList()
    await ready()
    expect(headers()).toEqual(["", "Thumb", "Title", "Season/Episode", "Artist", "Collection", "Tags", ""])
    expect(screen.queryByRole("columnheader", { name: "Year" })).toBeNull()
    expect(screen.queryByRole("columnheader", { name: "Size" })).toBeNull()
  })

  it("keeps the cell texts: Season/Episode, fallbacks, Uncategorized, artist before uploader", async () => {
    serve([
      item(1, { seasonNumber: 2, sequenceNumber: 5, artistName: "Artist A", uploader: "Up", collectionName: "Col" }),
      item(2, { uploader: "Uploader B" }),
      item(3, { seasonNumber: 1 }),
    ])
    renderList()
    await ready("5. Title 1")
    expect(within(row("5. Title 1")).getByText("S02E05")).toBeInTheDocument()
    expect(within(row("5. Title 1")).getByText("Artist A")).toBeInTheDocument()
    expect(within(row("5. Title 1")).getByText("Col")).toBeInTheDocument()
    expect(within(row("Title 2")).getByText("Uploader B")).toBeInTheDocument()
    expect(within(row("Title 2")).getByText("Uncategorized")).toBeInTheDocument()
    expect(within(row("Title 2")).getAllByText("—")).toHaveLength(1)
    expect(within(row("Title 3")).getByText("S01")).toBeInTheDocument()
  })

  it("offers the optional columns in the table's Columns menu and shows them with their formats", async () => {
    const user = userEvent.setup()
    serve([item(1, { year: 1999, fileSizeBytes: 2048, duration: 3725 })])
    renderList()
    await ready()
    await user.click(screen.getByRole("button", { name: "Columns" }))
    const menu = await screen.findByRole("menu")
    expect(within(menu).getAllByRole("menuitemcheckbox").map((i) => i.textContent)).toEqual([
      "Season/Episode",
      "Year",
      "Duration",
      "Downloaded",
      "Artist",
      "Collection",
      "Size",
      "Tags",
    ])
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Year" })).toHaveAttribute("aria-checked", "false")
    for (const name of ["Year", "Duration", "Downloaded", "Size"]) await user.click(within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name }))
    expect(headers()).toEqual(["", "Thumb", "Title", "Season/Episode", "Year", "Duration", "Downloaded", "Artist", "Collection", "Size", "Tags", ""])
    const cells = within(row("Title 1"))
    expect(cells.getByText("1999")).toBeInTheDocument()
    expect(cells.getByText("2.0 KB")).toBeInTheDocument()
    expect(cells.getByText(new Date("2026-03-05T10:00:00Z").toLocaleDateString())).toBeInTheDocument()
  })

  it("puts the Columns menu and the Layout button in the thin row above the table, and the old toolbar has no Columns control", async () => {
    serve(ITEMS)
    renderList()
    await ready()
    expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Table layout" })).toBeInTheDocument()
    cleanup()
    serve(ITEMS)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TooltipProvider>
            <LibrarySortProvider>
              <SelectionProvider>
                <LibraryToolbar />
              </SelectionProvider>
            </LibrarySortProvider>
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findByRole("button", { name: "Add item" })
    await settle()
    expect(screen.queryByRole("button", { name: /columns/i })).toBeNull()
  })
})

describe("LibraryListView on DataTable: saved layout", () => {
  it("applies a saved layout's hidden columns, widths and sort, and it is not dirty", async () => {
    const fn = serve(ITEMS, { layouts: { library: { v: 1, sort: { key: "title", dir: "desc" }, hidden: ["artist", "tags", "year"], widths: { collection: 260 } } } })
    renderList()
    await ready()
    // The saved `hidden` replaces the defaults: Year, Artist and Tags are off, everything else is on.
    expect(headers()).toEqual(["", "Thumb", "Title", "Season/Episode", "Duration", "Downloaded", "Collection", "Size", ""])
    expect(colWidths()).toContain("260px")
    expect(screen.queryByTestId("layout-dirty-dot")).toBeNull()
    expect(libraryParams(fn)[0].get("sortKey")).toBe("title")
    expect(libraryParams(fn)[0].get("sortDir")).toBe("desc")
  })

  it("a layout saved for its sort only keeps Year, Duration, Downloaded and Size hidden, and is not dirty", async () => {
    serve(ITEMS, { layouts: { library: { v: 1, sort: { key: "title", dir: "asc" } } } })
    renderList()
    await ready()
    expect(headers()).toEqual(["", "Thumb", "Title", "Season/Episode", "Artist", "Collection", "Tags", ""])
    expect(screen.queryByTestId("layout-dirty-dot")).toBeNull()
  })

  it("an explicit empty hidden shows every column", async () => {
    serve(ITEMS, { layouts: { library: { v: 1, hidden: [] } } })
    renderList()
    await ready()
    expect(headers()).toEqual(["", "Thumb", "Title", "Season/Episode", "Year", "Duration", "Downloaded", "Artist", "Collection", "Size", "Tags", ""])
  })

  it("Restore returns to the saved layout and Clear to the defaults", async () => {
    const user = userEvent.setup()
    const fn = serve(ITEMS, { layouts: { library: { v: 1, hidden: ["artist"] } } })
    renderList()
    await ready()
    expect(headers()).toEqual(["", "Thumb", "Title", "Season/Episode", "Year", "Duration", "Downloaded", "Collection", "Size", "Tags", ""])

    await user.click(screen.getByRole("button", { name: "Columns" }))
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Tags" }))
    await user.keyboard("{Escape}")
    expect(screen.getByTestId("layout-dirty-dot")).toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId("layout").textContent!).hidden).toEqual(["artist", "tags"])

    await user.click(screen.getByRole("button", { name: "Table layout" }))
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore saved" }))
    expect(JSON.parse(screen.getByTestId("layout").textContent!)).toEqual({ v: 1, hidden: ["artist"] })
    expect(screen.queryByTestId("layout-dirty-dot")).toBeNull()

    await user.click(screen.getByRole("button", { name: "Table layout" }))
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Clear saved layout" }))
    await waitFor(() => expect(JSON.parse(screen.getByTestId("layout").textContent!).hidden).toEqual(["downloadedAt", "duration", "size", "year"]))
    expect(fn.mock.calls.some(([url, init]) => url.endsWith("/auth/table-layouts/library") && init?.method === "DELETE")).toBe(true)
    expect(headers()).toEqual(["", "Thumb", "Title", "Season/Episode", "Artist", "Collection", "Tags", ""])
  })

  it("Save sends the hidden columns, widths and sort of the library layout", async () => {
    const user = userEvent.setup()
    const fn = serve(ITEMS)
    renderList()
    await ready()

    await user.click(screen.getByRole("button", { name: "Columns" }))
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Artist" }))
    await user.keyboard("{Escape}")
    await user.click(sortButton("Title"))
    const handle = screen.getByRole("separator", { name: "Resize Collection column" })
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1, button: 0 })
    fireEvent.pointerMove(handle, { clientX: 560, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 560, pointerId: 1 })

    await user.click(screen.getByRole("button", { name: "Table layout" }))
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }))
    const put = fn.mock.calls.find(([url, init]) => url.endsWith("/auth/table-layouts/library") && init?.method === "PUT")!
    expect(JSON.parse(put[1].body as string)).toEqual({
      v: 1,
      sort: { key: "title", dir: "asc" },
      hidden: ["artist", "downloadedAt", "duration", "size", "year"],
      widths: { collection: 260 },
    })
  })
})

describe("LibraryListView on DataTable: sorting", () => {
  it("cycles asc, desc and back to the default order with one request per change", async () => {
    const user = userEvent.setup()
    const fn = serve(ITEMS)
    renderList()
    await ready()
    expect(libraryParams(fn)).toHaveLength(1)
    expect(header("Title")).toHaveAttribute("aria-sort", "none")

    await user.click(sortButton("Title"))
    await waitFor(() => expect(libraryParams(fn)).toHaveLength(2))
    await settle()
    expect(libraryParams(fn)).toHaveLength(2)
    expect(libraryParams(fn)[1].get("sortKey")).toBe("title")
    expect(libraryParams(fn)[1].get("sortDir")).toBe("asc")
    expect(libraryParams(fn)[1].get("page")).toBe("1")
    expect(header("Title")).toHaveAttribute("aria-sort", "ascending")

    await user.click(sortButton("Title"))
    await waitFor(() => expect(libraryParams(fn)).toHaveLength(3))
    expect(libraryParams(fn)[2].get("sortDir")).toBe("desc")
    expect(header("Title")).toHaveAttribute("aria-sort", "descending")

    await user.click(sortButton("Title"))
    await waitFor(() => expect(libraryParams(fn)).toHaveLength(4))
    await settle()
    expect(libraryParams(fn)).toHaveLength(4)
    expect(libraryParams(fn)[3].get("sortKey")).toBe("downloadedAt")
    expect(libraryParams(fn)[3].get("sortDir")).toBe("desc")
    expect(header("Title")).toHaveAttribute("aria-sort", "none")
  })

  it("sorts by the Season/Episode column's server key and updates the shared sort", async () => {
    const user = userEvent.setup()
    const fn = serve(ITEMS)
    renderList()
    await ready()
    await user.click(sortButton("Season/Episode"))
    await waitFor(() => expect(libraryParams(fn)).toHaveLength(2))
    expect(libraryParams(fn)[1].get("sortKey")).toBe("seasonNumber")
    expect(screen.getByTestId("sort").textContent).toBe("seasonNumber:asc")
  })

  it("sorts by a column that is shown on request (Year); the default sort's column starts descending and moves on to asc", async () => {
    const user = userEvent.setup()
    const fn = serve(ITEMS)
    renderList()
    await ready()
    await user.click(screen.getByRole("button", { name: "Columns" }))
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Year" }))
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Downloaded" }))
    await user.keyboard("{Escape}")
    expect(header("Downloaded")).toHaveAttribute("aria-sort", "descending")
    await user.click(sortButton("Year"))
    await waitFor(() => expect(libraryParams(fn)).toHaveLength(2))
    expect(libraryParams(fn)[1].get("sortKey")).toBe("year")
    expect(header("Downloaded")).toHaveAttribute("aria-sort", "none")
    await user.click(sortButton("Downloaded"))
    await waitFor(() => expect(libraryParams(fn)).toHaveLength(3))
    expect(libraryParams(fn)[2].get("sortKey")).toBe("downloadedAt")
    expect(libraryParams(fn)[2].get("sortDir")).toBe("asc")
  })

  it("a sort set elsewhere (the toolbar dialog) shows in the header; one without a column shows no arrow", async () => {
    const user = userEvent.setup()
    const fn = serve(ITEMS)
    renderList()
    await ready()
    await user.click(screen.getByRole("button", { name: "sort by filename" }))
    await waitFor(() => expect(libraryParams(fn)).toHaveLength(2))
    expect(libraryParams(fn)[1].get("sortKey")).toBe("filename")
    for (const name of ["Title", "Season/Episode"]) expect(header(name)).toHaveAttribute("aria-sort", "none")
    expect(document.querySelector("thead svg")).toBeNull()
    // A layout sorted by an extra key is kept: it counts as a change from the default and can be saved.
    expect(screen.getByTestId("layout-dirty-dot")).toBeInTheDocument()
    // The next header click moves on to that column.
    await user.click(sortButton("Title"))
    await waitFor(() => expect(libraryParams(fn)).toHaveLength(3))
    expect(libraryParams(fn)[2].get("sortKey")).toBe("title")
    expect(libraryParams(fn)[2].get("sortDir")).toBe("asc")
  })
})

describe("LibraryListView on DataTable: footer", () => {
  it("with pagination on shows the pager and moves pages with one request", async () => {
    const user = userEvent.setup()
    const fn = serve(ITEMS)
    renderList()
    await ready()
    expect(footer()).toBe("7 items")
    expect(screen.getByRole("button", { name: "3" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Title 4")
    expect(libraryParams(fn).map((p) => p.get("page"))).toEqual(["1", "2"])
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page")
  })

  it("with pagination off shows the count and no usable pager, and requests no page", async () => {
    const fn = serve(ITEMS, { settings: { libraryPaginationEnabled: false } })
    renderList()
    await screen.findByText("Title 7")
    expect(footer()).toBe("7 items")
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
    expect(libraryParams(fn)[0].has("page")).toBe(false)
    expect(libraryParams(fn)[0].has("pageSize")).toBe(false)
  })

  it("shows the toolbar's number as the selected count, whatever is on the page", async () => {
    const user = userEvent.setup()
    serve(ITEMS)
    renderList()
    await ready()
    await user.click(checkbox("Title 1"))
    await user.click(checkbox("Title 2"))
    expect(footer()).toBe("7 items · 2 selected")
    await user.click(screen.getByRole("button", { name: "pick collection" }))
    expect(approx()).toBe("12")
    expect(screen.getByText("7 items · 12 selected")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Title 4")
    expect(screen.getByText("7 items · 12 selected")).toBeInTheDocument()
  })

  it("shows the placeholder while loading and on error", async () => {
    serve(ITEMS, { library: () => ({ status: 500, body: { error: "boom" } }) })
    renderList()
    expect(screen.getByText("—")).toBeInTheDocument()
    await screen.findByText(/Failed to load library: /)
    expect(screen.getByText("—")).toBeInTheDocument()
  })
})

describe("LibraryListView on DataTable: states", () => {
  it("shows skeletons first, then the table", async () => {
    serve(ITEMS)
    renderList()
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    expect(screen.queryByRole("table")).toBeNull()
    await ready()
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull()
  })

  it("shows the failure message", async () => {
    serve(ITEMS, { library: () => ({ status: 500, body: { error: "kaput" } }) })
    renderList()
    expect(await screen.findByText(/Failed to load library: kaput/)).toBeInTheDocument()
  })

  it("explains an empty library and an empty filter result differently and keeps the footer", async () => {
    serve([])
    renderList()
    expect(await screen.findByText("Nothing here yet. Completed downloads will show up in your library.")).toBeInTheDocument()
    expect(footer()).toBe("0 items")
    cleanup()
    serve([])
    renderList(["/library?q=zzz"])
    expect(await screen.findByText("No library items match these filters.")).toBeInTheDocument()
  })
})

describe("LibraryListView on DataTable: privacy", () => {
  const PRIVATE = item(1, { title: "Secret Show", blurred: true, thumbnailSmallPath: "thumbs/1.jpg" })

  it("hashes the title and the row label and blurs the thumbnail until it is revealed; the reveal click does not select the row", async () => {
    const user = userEvent.setup()
    serve([PRIVATE, item(2)])
    renderList()
    const hashed = hashText("Secret Show")
    await screen.findByText(hashed)
    expect(screen.queryByText("Secret Show")).toBeNull()
    expect(screen.getByRole("checkbox", { name: `Select ${hashed}` })).toBeInTheDocument()
    const img = row(hashed).querySelector("img")!
    expect(img.className).toMatch(/blur/)

    await user.click(img)
    expect(await screen.findByText("Secret Show")).toBeInTheDocument()
    expect(row("Secret Show").querySelector("img")!.className).not.toMatch(/blur/)
    expect(screen.getByRole("checkbox", { name: "Select Secret Show" })).toBeInTheDocument()
    expect(isSelected("Secret Show")).toBe(false)
    expect(approx()).toBe("0")

    await user.click(row("Secret Show").querySelector("img")!)
    expect(await screen.findByText(hashed)).toBeInTheDocument()
    expect(approx()).toBe("0")
  })

  it("the title link navigates and never selects the row", async () => {
    const user = userEvent.setup()
    serve([PRIVATE, item(2)])
    renderList()
    await screen.findByText(hashText("Secret Show"))
    await user.click(screen.getByRole("link", { name: hashText("Secret Show") }))
    expect(screen.getByTestId("location").textContent).toBe("/library/1")
    expect(approx()).toBe("0")
  })
})

describe("LibraryListView on DataTable: selection", () => {
  it("click selects only the row, ctrl toggles, shift selects a range", async () => {
    serve(ITEMS)
    renderList()
    await ready()
    press("Title 1")
    expect(isSelected("Title 1")).toBe(true)
    press("Title 3", { ctrlKey: true })
    expect(isSelected("Title 1") && isSelected("Title 3")).toBe(true)
    press("Title 2")
    expect([isSelected("Title 1"), isSelected("Title 2"), isSelected("Title 3")]).toEqual([false, true, false])
    press("Title 1")
    press("Title 3", { shiftKey: true })
    expect([isSelected("Title 1"), isSelected("Title 2"), isSelected("Title 3")]).toEqual([true, true, true])
    expect(approx()).toBe("3")
    expect(footer()).toBe("7 items · 3 selected")
  })

  it("a drag selects the range under the pointer", async () => {
    serve(ITEMS)
    renderList()
    await ready()
    fireEvent.mouseDown(row("Title 1"))
    fireEvent.mouseEnter(row("Title 2"))
    fireEvent.mouseEnter(row("Title 3"))
    fireEvent.mouseUp(window)
    expect([isSelected("Title 1"), isSelected("Title 2"), isSelected("Title 3")]).toEqual([true, true, true])
    expect(approx()).toBe("3")
  })

  it("checkboxes accumulate across pages while click, drag and the header checkbox replace everything", async () => {
    const user = userEvent.setup()
    serve(ITEMS)
    renderList()
    await ready()
    await user.click(checkbox("Title 1"))
    await user.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Title 4")
    await user.click(checkbox("Title 5"))
    expect(approx()).toBe("2")
    press("Title 6", { ctrlKey: true })
    expect(approx()).toBe("3")
    await user.click(screen.getByRole("button", { name: "pick collection" }))
    expect(approx()).toBe("13")

    // A plain click starts over: the other page's item AND the collection go.
    press("Title 4")
    expect(approx()).toBe("1")
    expect(screen.getByTestId("collections").textContent).toBe("0")
    expect(isSelected("Title 4")).toBe(true)
    expect(isSelected("Title 5")).toBe(false)

    await user.click(screen.getByRole("button", { name: "pick collection" }))
    await user.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(approx()).toBe("3")
    expect(screen.getByTestId("collections").textContent).toBe("0")
    expect([4, 5, 6].every((i) => isSelected(`Title ${i}`))).toBe(true)

    await user.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(approx()).toBe("0")
    // Back on page 1 the item picked there before is gone as well.
    await user.click(screen.getByRole("button", { name: "Previous" }))
    await screen.findByText("Title 1")
    expect(isSelected("Title 1")).toBe(false)
  })

  it("keeps the selection through a sort change", async () => {
    const user = userEvent.setup()
    serve(ITEMS)
    renderList()
    await ready()
    await user.click(checkbox("Title 2"))
    await user.click(sortButton("Title"))
    await waitFor(() => expect(screen.getByTestId("sort").textContent).toBe("title:asc"))
    await settle()
    expect(approx()).toBe("1")
    expect(isSelected("Title 2")).toBe(true)
  })
})

describe("LibraryListView on DataTable: controls stay live with a selection", () => {
  it("the title link, the thumbnail reveal, the tags popover and the actions menu work and never select", async () => {
    const user = userEvent.setup()
    serve([
      item(1, { title: "Private", blurred: true, thumbnailSmallPath: "t/1.jpg", tags: ["a", "b", "c", "d", "e"] }),
      item(2),
    ])
    renderList()
    await screen.findByText(hashText("Private"))
    press("Title 2")
    expect(approx()).toBe("1")

    // Thumbnail: reveals, selection unchanged.
    await user.click(row(hashText("Private")).querySelector("img")!)
    await screen.findByText("Private")
    expect(approx()).toBe("1")
    expect(isSelected("Title 2")).toBe(true)

    // Tags: three badges and "+2"; the popover lists them all.
    const tagsButton = within(row("Private")).getByRole("button", { name: /\+2/ })
    await user.click(tagsButton)
    expect(await screen.findByText("e")).toBeInTheDocument()
    expect(approx()).toBe("1")
    await user.keyboard("{Escape}")

    // Actions menu opens.
    const actions = row("Private").querySelector("td:last-child button") as HTMLElement
    await user.click(actions)
    expect(await screen.findByRole("menuitem", { name: /Edit/ })).toBeInTheDocument()
    expect(approx()).toBe("1")
    await user.keyboard("{Escape}")

    // Title link navigates.
    await user.click(screen.getByRole("link", { name: "Private" }))
    expect(screen.getByTestId("location").textContent).toBe("/library/1")
    expect(approx()).toBe("1")
  })
})

describe("LibraryListView on DataTable: queries", () => {
  it("a filter change on a later page makes one request, with page 1", async () => {
    const user = userEvent.setup()
    const fn = serve(ITEMS)
    renderList()
    await ready()
    await user.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Title 4")
    const before = libraryParams(fn).length
    await act(async () => {
      await user.click(sortButton("Title"))
    })
    await waitFor(() => expect(libraryParams(fn).length).toBeGreaterThan(before))
    await settle()
    const added = libraryParams(fn).slice(before)
    expect(added).toHaveLength(1)
    expect(added[0].get("page")).toBe("1")
  })
})

describe("LibraryListView: one toolbar", () => {
  const settingsPatches = (fn: Fetch) => fn.mock.calls.filter(([url, init]) => url.endsWith("/settings") && init?.method === "PATCH")

  it("has a single toolbar row: Add item, Bulk operations, Filters & Sort, search, Columns, Layout and the settings cog in one group", async () => {
    serve(ITEMS)
    renderList()
    await ready()
    expect(screen.getAllByRole("button", { name: "Add item" })).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "Columns" })).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "Table layout" })).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Bulk operations" })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Filters & Sort/ })).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Search library…")).toBeInTheDocument()
    const group = screen.getByRole("group")
    expect(within(group).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Columns", "Table layout", "Library display settings"])
    expect(document.querySelectorAll("[data-slot=table-container]")).toHaveLength(1)
  })

  it("shows no hint text, only the selected count with a Clear button once something is selected", async () => {
    const user = userEvent.setup()
    serve(ITEMS)
    renderList()
    await ready()
    expect(screen.queryByText(/Select files or collections/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull()
    await user.click(checkbox("Title 1"))
    await user.click(checkbox("Title 2"))
    expect(screen.getByText("2 selected")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bulk operations" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "Clear" }))
    expect(screen.queryByText("2 selected")).toBeNull()
    expect(approx()).toBe("0")
  })

  it("Bulk operations opens the bulk dialogs for the selection", async () => {
    const user = userEvent.setup()
    serve(ITEMS)
    renderList()
    await ready()
    await user.click(checkbox("Title 1"))
    await user.click(screen.getByRole("button", { name: "Bulk operations" }))
    await user.click(await screen.findByRole("menuitem", { name: /Edit…/ }))
    expect(await screen.findByText(/Edit 1 selected file/)).toBeInTheDocument()
  })

  it("the search updates the URL q after the debounce with exactly one request, on a later page too", async () => {
    const user = userEvent.setup()
    const fn = serve(ITEMS)
    renderList()
    await ready()
    await user.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("Title 4")
    const before = libraryParams(fn).length
    await user.type(screen.getByPlaceholderText("Search library…"), "abc")
    await waitFor(() => expect(screen.getByTestId("q").textContent).toBe("abc"))
    await settle()
    const added = libraryParams(fn).slice(before)
    expect(added).toHaveLength(1)
    expect(added[0].get("q")).toBe("abc")
    expect(added[0].get("page")).toBe("1")
    await user.click(screen.getByRole("button", { name: "Clear search" }))
    await waitFor(() => expect(screen.getByTestId("q").textContent).toBe(""))
    await settle()
    expect(libraryParams(fn).slice(before)).toHaveLength(2)
  })

  it("starts from the q in the URL", async () => {
    const fn = serve(ITEMS)
    renderList(["/library?q=zed"])
    await ready()
    expect(screen.getByPlaceholderText("Search library…")).toHaveValue("zed")
    expect(libraryParams(fn)[0].get("q")).toBe("zed")
  })

  it("the cog Apply sends the same settings PATCH as the classic toolbar", async () => {
    const user = userEvent.setup()
    const fn = serve(ITEMS)
    renderList()
    await ready()
    await user.click(screen.getByRole("button", { name: "Library display settings" }))
    await user.click(await screen.findByRole("button", { name: "Grid" }))
    await user.click(screen.getByRole("button", { name: "Details" }))
    await user.click(screen.getByRole("button", { name: "Apply" }))
    await waitFor(() => expect(settingsPatches(fn)).toHaveLength(1))
    expect(JSON.parse(settingsPatches(fn)[0][1].body as string)).toEqual({ libraryMode: "details", libraryView: "grid" })
  })

  it("Filters & Sort opens the dialog and Apply sets the shared sort", async () => {
    const user = userEvent.setup()
    serve(ITEMS)
    renderList()
    await ready()
    await user.click(screen.getByRole("button", { name: /Filters & Sort/ }))
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apply" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})

describe("LibraryToolbar (grid and folders): classic toolbar", () => {
  it("keeps its controls, has no hint text and shows the selected count", async () => {
    const user = userEvent.setup()
    serve(ITEMS, { settings: { libraryView: "grid" } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TooltipProvider>
            <LibrarySortProvider>
              <SelectionProvider>
                <Probe />
                <LibraryToolbar />
              </SelectionProvider>
            </LibrarySortProvider>
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findByRole("button", { name: "Add item" })
    expect(screen.getByRole("button", { name: "Bulk operations" })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Filters & Sort/ })).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Search library…")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Library display settings" })).toBeInTheDocument()
    expect(screen.queryByText(/Select files or collections/)).toBeNull()
    await user.click(screen.getByRole("button", { name: "pick collection" }))
    expect(screen.getByText("10 selected")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument()
  })
})

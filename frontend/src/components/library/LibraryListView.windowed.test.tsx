import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { installLayoutMock } from "@/test/layoutMock"
import type { LayoutMock } from "@/test/layoutMock"
import { mockFetch } from "@/test/mockApi"
import type { LibraryItem } from "@/types/api"
import { LibraryListView } from "./LibraryListView"
import { LibrarySortProvider } from "./LibrarySortContext"
import { RevealAllProvider } from "./RevealAllContext"
import { SelectionProvider } from "./SelectionContext"

// The Library list opts in to DataTable windowing: above the threshold only the rows near the viewport are mounted, at or
// below it (a small library, a paged one) the table is the plain one.
let layout: LayoutMock
beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => {}
  layout = installLayoutMock({ viewportWidth: 1280, viewportHeight: 600, rowHeight: () => 50 })
})
afterEach(() => {
  cleanup()
  layout.restore()
})

const item = (id: number) =>
  ({
    id,
    title: `Title ${id}`,
    filename: `f${id}.mp4`,
    path: `m/f${id}.mp4`,
    collectionId: null,
    collectionName: null,
    artistName: null,
    uploader: null,
    year: null,
    duration: 60,
    seasonNumber: null,
    sequenceNumber: null,
    fileSizeBytes: null,
    downloadedAt: "2026-03-05T10:00:00Z",
    mediaType: "video",
    thumbnail: null,
    thumbnailSmallPath: null,
    blurred: false,
    tags: [],
  }) as unknown as LibraryItem

function serve(total: number, settings: Record<string, unknown> = {}) {
  const all = Array.from({ length: total }, (_, i) => item(i + 1))
  return mockFetch((url) => {
    if (url.endsWith("/auth/table-layouts")) return { status: 200, body: { layouts: {} } }
    if (url.includes("/library?")) {
      const params = new URL(url, "http://x").searchParams
      const size = Number(params.get("pageSize") ?? all.length)
      const page = Number(params.get("page") ?? "1")
      return { status: 200, body: { items: all.slice((page - 1) * size, page * size), total: all.length } }
    }
    if (url.endsWith("/settings")) return { status: 200, body: { libraryView: "list", libraryMode: "manage", libraryPaginationEnabled: false, ...settings } }
    if (url.endsWith("/library/facets")) return { status: 200, body: { years: [] } }
    if (url.endsWith("/collections") || url.endsWith("/tags") || url.endsWith("/artists") || url.includes("/compare")) return { status: 200, body: [] }
    return { status: 200, body: {} }
  })
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/library"]}>
        <TooltipProvider>
          <LibrarySortProvider>
            <RevealAllProvider>
              <SelectionProvider>
                <LibraryListView />
              </SelectionProvider>
            </RevealAllProvider>
          </LibrarySortProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const rowCount = () => document.querySelectorAll("tbody tr[data-row-id]").length
const spacers = () => document.querySelectorAll("tbody tr[data-windowed-spacer]").length

describe("LibraryListView windowing", () => {
  it("windows a long list: a bounded window of rows, every item counted, select-all selects all of them", async () => {
    serve(600)
    renderList()
    await screen.findByText("Title 1")
    await waitFor(() => expect(spacers()).toBe(2))
    expect(rowCount()).toBeLessThan(60)
    expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "601")
    expect(screen.getByText(/^600 items?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    await waitFor(() => expect(screen.getAllByText(/600 selected/).length).toBeGreaterThan(0))
  })

  it("is the plain table for a small library", async () => {
    serve(50)
    renderList()
    await screen.findByText("Title 1")
    expect(rowCount()).toBe(50)
    expect(spacers()).toBe(0)
    expect(screen.getByRole("table")).not.toHaveAttribute("aria-rowcount")
  })

  it("is the plain table when pagination keeps a page at or below the threshold", async () => {
    serve(600, { libraryPaginationEnabled: true, libraryPageSize: 48 })
    renderList()
    await screen.findByText("Title 1")
    expect(rowCount()).toBe(48)
    expect(spacers()).toBe(0)
  })
})

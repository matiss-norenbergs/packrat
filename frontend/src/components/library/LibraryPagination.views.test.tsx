import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, useSearchParams } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LibraryFolderView } from "./LibraryFolderView"
import { LibraryGrid } from "./LibraryGrid"
import { LibrarySortProvider } from "./LibrarySortContext"

// Only the footer is under test, so the library answers with a total and no items.
let settings: Record<string, unknown>
let libraryTotal: number
let fetchMock: ReturnType<typeof vi.fn>

const libraryCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/library?"))
const pageOf = (call: unknown[]) => new URL(String(call[0]), "http://x").searchParams.get("page")

function respond(body: unknown) {
  return { ok: true, status: 200, statusText: "200", headers: { get: () => null }, json: async () => body }
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  settings = { libraryPaginationEnabled: true, libraryPageSize: 24 }
  libraryTotal = 60
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/auth/table-layouts")) return respond({ layouts: {} })
    if (url.includes("/library?")) return respond({ items: [], total: libraryTotal })
    if (url.endsWith("/settings")) return respond(settings)
    if (url.endsWith("/collections") || url.endsWith("/tags")) return respond([])
    return respond({})
  })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Stands in for the toolbar: changes the URL filters.
function Filters() {
  const [, setParams] = useSearchParams()
  return (
    <button type="button" onClick={() => setParams({ q: "abc" })}>
      search
    </button>
  )
}

function renderView(view: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <LibrarySortProvider>
            <Filters />
            {view}
          </LibrarySortProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe.each([
  ["grid", <LibraryGrid key="g" />],
  ["folder view", <LibraryFolderView key="f" />],
])("%s footer", (_name, view) => {
  it("shows the shared table footer when pagination is enabled", async () => {
    renderView(view)
    expect(await screen.findByText("60 items")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "3" })).toBeInTheDocument()
    expect(screen.queryByText(/page \d+ of/i)).not.toBeInTheDocument()
  })

  it("shows it for a single page too", async () => {
    libraryTotal = 5
    renderView(view)
    expect(await screen.findByText("5 items")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
  })

  it("renders no footer when pagination is disabled", async () => {
    settings = { libraryPaginationEnabled: false }
    renderView(view)
    await waitFor(() => expect(libraryCalls()).toHaveLength(1))
    expect(String(libraryCalls()[0][0])).not.toContain("page=")
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/\d+ items/)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument()
  })

  it("a filter change on page 1 is exactly one more query", async () => {
    const user = userEvent.setup()
    renderView(view)
    await screen.findByText("60 items")
    expect(libraryCalls()).toHaveLength(1)

    await user.click(screen.getByRole("button", { name: "search" }))
    await waitFor(() => expect(libraryCalls()).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 50))
    expect(libraryCalls()).toHaveLength(2)
    expect(pageOf(libraryCalls()[1])).toBe("1")
  })

  it("the clamp adds no request when a filter change resets a later page", async () => {
    const user = userEvent.setup()
    renderView(view)
    await user.click(await screen.findByRole("button", { name: "2" }))
    await waitFor(() => expect(libraryCalls()).toHaveLength(2))
    expect(pageOf(libraryCalls()[1])).toBe("2")
    await screen.findByText("60 items")

    libraryTotal = 10
    await user.click(screen.getByRole("button", { name: "search" }))
    await screen.findByText("10 items")
    await new Promise((r) => setTimeout(r, 100))
    // The reset's own page-1 request ends it: the clamp finds page 1 valid and does not request again.
    expect(pageOf(libraryCalls().at(-1)!)).toBe("1")
    const settled = libraryCalls().length
    await new Promise((r) => setTimeout(r, 100))
    expect(libraryCalls()).toHaveLength(settled)
  })
})

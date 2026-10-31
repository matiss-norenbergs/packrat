import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, useNavigate, useSearchParams } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useLibrarySort } from "@/hooks/useLibrarySort"
import { LibraryFolderView } from "./LibraryFolderView"
import { LibraryGrid } from "./LibraryGrid"
import { LibraryListView } from "./LibraryListView"
import { LibrarySortProvider } from "./LibrarySortContext"

// Only the footer and the requests are under test, so the library answers with a total and no items.
let settings: Record<string, unknown>
let libraryTotal: number
let fetchMock: ReturnType<typeof vi.fn>

const libraryCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/library?"))
const paramsOf = (call: unknown[]) => new URL(String(call[0]), "http://x").searchParams
const pageOf = (call: unknown[]) => paramsOf(call).get("page")
const settle = () => new Promise((r) => setTimeout(r, 100))

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

// Stands in for the toolbar and the sort dialog: changes the URL filters and the shared sort.
function Controls() {
  const [, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { setSort } = useLibrarySort()
  const set = (k: string, v: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p)
      next.set(k, v)
      return next
    })
  return (
    <>
      <button type="button" onClick={() => set("q", "abc")}>search</button>
      <button type="button" onClick={() => set("collection", "7")}>collection</button>
      <button type="button" onClick={() => set("year", "1999")}>year</button>
      <button type="button" onClick={() => set("tags", "a,b")}>tags</button>
      <button type="button" onClick={() => set("hideGhosts", "true")}>ghosts</button>
      <button type="button" onClick={() => setSort({ key: "title", dir: "asc" })}>sort</button>
      <button type="button" onClick={() => navigate(-1)}>back</button>
    </>
  )
}

function renderView(view: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <LibrarySortProvider>
            <Controls />
            {view}
          </LibrarySortProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

type Case = { name: string; view: React.ReactNode; actions: [button: string, param: string, value: string][] }
const common: Case["actions"] = [
  ["search", "q", "abc"],
  ["tags", "tags", "a,b"],
  ["ghosts", "hideGhosts", "true"],
  ["sort", "sortKey", "title"],
]
const cases: Case[] = [
  { name: "grid", view: <LibraryGrid key="g" />, actions: [...common, ["collection", "collectionId", "7"], ["year", "year", "1999"]] },
  { name: "folder view", view: <LibraryFolderView key="f" />, actions: [...common, ["collection", "collectionId", "7"]] },
  { name: "list view", view: <LibraryListView key="l" />, actions: [...common, ["collection", "collectionId", "7"], ["year", "year", "1999"]] },
]

describe.each(cases)("$name footer", ({ name, view, actions }) => {
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
    await settle()
    if (name === "list view") {
      // The table's own footer is always there: one page holding everything, so only the count is of use.
      expect(screen.getByText("60 items")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
      expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
      return
    }
    expect(screen.queryByText(/\d+ items/)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument()
  })

  it("moves to the next page", async () => {
    const user = userEvent.setup()
    renderView(view)
    await screen.findByText("60 items")
    await user.click(screen.getByRole("button", { name: "Next" }))
    await waitFor(() => expect(libraryCalls()).toHaveLength(2))
    expect(pageOf(libraryCalls()[1])).toBe("2")
  })

  it.each(actions)("on page 2, '%s' makes exactly one request, with page 1 and the new parameter", async (button, param, value) => {
    const user = userEvent.setup()
    renderView(view)
    await user.click(await screen.findByRole("button", { name: "2" }))
    await waitFor(() => expect(libraryCalls()).toHaveLength(2))
    await screen.findByText("60 items")
    const before = libraryCalls().length

    await user.click(screen.getByRole("button", { name: button }))
    await waitFor(() => expect(libraryCalls().length).toBeGreaterThan(before))
    await settle()
    const added = libraryCalls().slice(before)
    expect(added).toHaveLength(1)
    expect(pageOf(added[0])).toBe("1")
    expect(paramsOf(added[0]).get(param)).toBe(value)
    // Never a request with the new parameter and the old page.
    expect(libraryCalls().some((c) => paramsOf(c).get(param) === value && pageOf(c) === "2")).toBe(false)
  })

  it.each(actions)("on page 1, '%s' still makes exactly one request", async (button, param, value) => {
    const user = userEvent.setup()
    renderView(view)
    await screen.findByText("60 items")
    const before = libraryCalls().length
    await user.click(screen.getByRole("button", { name: button }))
    await waitFor(() => expect(libraryCalls().length).toBeGreaterThan(before))
    await settle()
    const added = libraryCalls().slice(before)
    expect(added).toHaveLength(1)
    expect(pageOf(added[0])).toBe("1")
    expect(paramsOf(added[0]).get(param)).toBe(value)
  })

  it("browser back after a filter change shows page 1 of the old filters with one request", async () => {
    const user = userEvent.setup()
    renderView(view)
    await user.click(await screen.findByRole("button", { name: "2" }))
    await waitFor(() => expect(libraryCalls()).toHaveLength(2))
    await user.click(screen.getByRole("button", { name: "search" }))
    await waitFor(() => expect(libraryCalls()).toHaveLength(3))
    await settle()
    const before = libraryCalls().length
    await user.click(screen.getByRole("button", { name: "back" }))
    await settle()
    // Back is a key change too (q goes away): page 1, one request (the old query's page 1 may come from the cache).
    expect(libraryCalls().length - before).toBeLessThanOrEqual(1)
    expect(libraryCalls().slice(before).every((c) => pageOf(c) === "1")).toBe(true)
  })

  it("the clamp adds no request when the total shrinks under the current page", async () => {
    const user = userEvent.setup()
    renderView(view)
    await user.click(await screen.findByRole("button", { name: "3" }))
    await waitFor(() => expect(libraryCalls()).toHaveLength(2))
    await screen.findByText("60 items")

    libraryTotal = 30
    // A refetch of the page the user is on (here: another click on 3) now reports 2 pages in total.
    await user.click(screen.getByRole("button", { name: "2" }))
    await waitFor(() => expect(libraryCalls()).toHaveLength(3))
    await screen.findByText("30 items")
    await settle()
    const settled = libraryCalls().length
    await settle()
    expect(libraryCalls()).toHaveLength(settled)
    expect(pageOf(libraryCalls().at(-1)!)).toBe("2")
  })
})

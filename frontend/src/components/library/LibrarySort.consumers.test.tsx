import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LibraryGrid } from "./LibraryGrid"
import { LibrarySortProvider } from "./LibrarySortContext"
import { LibraryToolbar } from "./LibraryToolbar"
import { TooltipProvider } from "@/components/ui/tooltip"

// Library data and the layouts are served by a hand-rolled fetch so a test can hold the layouts response back.
let layoutsResponse: Promise<Record<string, unknown>>
let fetchMock: ReturnType<typeof vi.fn>

const calls = (needle: string, method?: string) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).includes(needle) && (method ? (init?.method ?? "GET") === method : true))
const libraryCalls = () => calls("/library?")

function respond(body: unknown, status = 200) {
  return { ok: status < 300, status, statusText: String(status), headers: { get: () => null }, json: async () => body }
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  layoutsResponse = Promise.resolve({})
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    if (url.endsWith("/auth/table-layouts")) return respond({ layouts: await layoutsResponse })
    if (url.includes("/auth/table-layouts/") && method === "PUT") return respond(JSON.parse(init?.body as string))
    if (url.includes("/library?")) return respond({ items: [], total: 0 })
    if (url.endsWith("/settings")) return respond({ libraryView: "grid", libraryMode: "manage" })
    if (url.endsWith("/library/facets")) return respond({ years: [] })
    if (url.endsWith("/collections") || url.endsWith("/tags")) return respond([])
    return respond({})
  })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderLibrary(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <LibrarySortProvider>{ui}</LibrarySortProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("Library queries wait for the saved layouts", () => {
  it("fires once, with the saved sort, never with the default first", async () => {
    let release!: (v: Record<string, unknown>) => void
    layoutsResponse = new Promise((res) => (release = res))
    renderLibrary(<LibraryGrid />)
    await waitFor(() => expect(calls("/auth/table-layouts", "GET").length).toBe(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(libraryCalls()).toHaveLength(0)

    release({ library: { v: 1, sort: { key: "title", dir: "asc" } } })
    await waitFor(() => expect(libraryCalls()).toHaveLength(1))
    const url = String(libraryCalls()[0][0])
    expect(url).toContain("sortKey=title")
    expect(url).toContain("sortDir=asc")
  })

  it("uses the default when the layouts fail", async () => {
    layoutsResponse = Promise.reject(new Error("down"))
    renderLibrary(<LibraryGrid />)
    await waitFor(() => expect(libraryCalls()).toHaveLength(1))
    expect(String(libraryCalls()[0][0])).toContain("sortKey=downloadedAt")
    expect(String(libraryCalls()[0][0])).toContain("sortDir=desc")
  })
})

describe("Filters & Sort dialog", () => {
  async function openDialog() {
    const user = userEvent.setup()
    renderLibrary(
      <>
        <LibraryToolbar />
        <LibraryGrid />
      </>,
    )
    await user.click(await screen.findByRole("button", { name: /filters & sort/i }))
    const dialog = await screen.findByRole("dialog")
    const dirButton = () => dialog.querySelector("button svg.lucide-arrow-down-a-z, button svg.lucide-arrow-up-a-z")!.closest("button")!
    return { user, dialog, dirButton }
  }


  it("Apply changes the sort without a settings PATCH or a layout save", async () => {
    const { user, dialog, dirButton } = await openDialog()
    await user.click(dirButton())
    await user.click(within(dialog).getByRole("button", { name: "Apply" }))
    await waitFor(() => expect(libraryCalls().some(([u]) => String(u).includes("sortDir=asc"))).toBe(true))
    expect(calls("/settings", "PATCH")).toHaveLength(0)
    expect(calls("/auth/table-layouts/", "PUT")).toHaveLength(0)
  })

})

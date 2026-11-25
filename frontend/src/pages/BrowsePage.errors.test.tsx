import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import { BrowsePage } from "./BrowsePage"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const COLLECTION = { id: 1, name: "Shows", parentId: null, browseAsShow: false, totalItemCount: 2, itemCount: 2 }
const EMPTY = { items: [], total: 0 }

// `failing` lists url fragments that answer 500 until removed.
function setup(failing: Set<string>, collections: unknown[] = []) {
  mockFetch((url) => {
    for (const f of failing) if (url.includes(f)) return { status: 500, body: { error: "boom" } }
    if (url.includes("/library")) return { status: 200, body: EMPTY }
    if (url.includes("/collections")) return { status: 200, body: collections }
    return { status: 200, body: {} }
  })
}
const page = (route = "/") =>
  renderWithProviders(
    <TooltipProvider>
      <BrowsePage />
    </TooltipProvider>,
    route,
  )

describe("BrowsePage error states", () => {
  it("collections failing shows an error with Retry instead of skeletons, and retry recovers", async () => {
    const failing = new Set(["/collections"])
    setup(failing)
    page()
    expect(await screen.findByText("Couldn't load the library.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /retry/i })).toHaveClass("pointer-coarse:min-h-11")
    failing.clear()
    await userEvent.click(screen.getByRole("button", { name: /retry/i }))
    expect(await screen.findByText("Nothing downloaded yet.")).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load the library.")).toBeNull()
  })

  it("a failed recently-added query never reads 'Nothing downloaded yet.'", async () => {
    const failing = new Set(["sortKey=downloadedAt&sortDir=desc&page=1&pageSize=24"])
    setup(failing)
    page()
    expect(await screen.findByText("Couldn't load recently added items.")).toBeInTheDocument()
    expect(screen.queryByText("Nothing downloaded yet.")).toBeNull()
    failing.clear()
    await userEvent.click(screen.getByRole("button", { name: /retry/i }))
    expect(await screen.findByText("Nothing downloaded yet.")).toBeInTheDocument()
  })

  it("a failed search never reads 'No matches.'", async () => {
    const failing = new Set(["q=foo"])
    setup(failing)
    page("/?q=foo")
    expect(await screen.findByText("Search failed.")).toBeInTheDocument()
    expect(screen.queryByText("No matches.")).toBeNull()
    failing.clear()
    await userEvent.click(screen.getByRole("button", { name: /retry/i }))
    expect(await screen.findByText("No matches.")).toBeInTheDocument()
  })

  it("a failed per-collection row shows its own error and retries", async () => {
    const failing = new Set(["collectionIds=1"])
    setup(failing, [COLLECTION])
    page()
    expect(await screen.findByText("Couldn't load Shows.")).toBeInTheDocument()
    failing.clear()
    await userEvent.click(screen.getByRole("button", { name: /retry/i }))
    await waitFor(() => expect(screen.queryByText("Couldn't load Shows.")).toBeNull())
  })
})

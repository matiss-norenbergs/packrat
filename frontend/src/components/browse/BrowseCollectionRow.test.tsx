import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BROWSE_COLLECTION_ROW_COUNT, browseCollectionRowParams } from "@/lib/browseRows"
import { BrowseCollectionRow } from "./BrowseCollectionRow"

const fetchLibraryQuery = vi.fn()
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), fetchLibraryQuery: (...a: unknown[]) => fetchLibraryQuery(...a) }))
vi.mock("./BrowseRow", () => ({ BrowseRow: ({ title, items }: { title: string; items: unknown[] }) => <div data-testid="row">{title}:{items.length}</div> }))

afterEach(() => {
  cleanup()
  fetchLibraryQuery.mockReset()
})

describe("BrowseCollectionRow", () => {
  it("asks for a single capped, newest-first page of its subtree", async () => {
    fetchLibraryQuery.mockResolvedValue({ items: [{ id: 1 }], total: 1 })
    const client = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { findByTestId } = render(<BrowseCollectionRow title="Music" collectionIds={[1, 2]} />, { wrapper })
    expect((await findByTestId("row")).textContent).toBe("Music:0")
    await waitFor(() => expect(fetchLibraryQuery).toHaveBeenCalled())
    expect(fetchLibraryQuery.mock.calls[0][0]).toEqual({
      collectionIds: [1, 2], sortKey: "downloadedAt", sortDir: "desc", page: 1, pageSize: BROWSE_COLLECTION_ROW_COUNT, hideGhosts: true,
    })
  })

  it("keeps the cap at least the search-results size so normal collections render in full", () => {
    expect(BROWSE_COLLECTION_ROW_COUNT).toBeGreaterThanOrEqual(100)
    expect(browseCollectionRowParams([3]).page).toBe(1)
  })
})

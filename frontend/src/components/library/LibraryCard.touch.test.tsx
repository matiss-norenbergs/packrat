import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockFetch } from "@/test/mockApi"
import { trackClient } from "@/test/clients"
import { settleQueries } from "@/test/settle"
import type { LibraryItem } from "@/types/api"
import { LibraryCard, LibraryCardGrid } from "./LibraryCard"
import { LibraryCardsProvider } from "./LibraryCardsProvider"
import { RevealAllProvider } from "./RevealAllContext"
import { SelectionProvider } from "./SelectionContext"

// The card's select checkbox is hover-revealed with a mouse; on touch it is always shown and gets a 44 px tap area
// (a 20 px checkbox with a 2 px border, 14 px inset). The ⋮ stays 28 px on purpose and is not asserted here.
const item = {
  id: 1, title: "Clip", filename: "f.mp4", path: "m/f.mp4", mediaType: "video", status: "completed",
  originalUrl: "https://x/y", thumbnail: "t.jpg", blurred: false, tags: [], activeDownloadId: null,
} as unknown as LibraryItem

beforeEach(() => {
  mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: { libraryMode: "manage" } }
    return { status: 200, body: [] }
  })
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})

describe("LibraryCard select checkbox on touch", () => {
  it("is revealed and enlarged under pointer-coarse; the mouse reveal is unchanged", async () => {
    const router = createMemoryRouter(
      [{
        path: "/",
        element: (
          <RevealAllProvider>
            <SelectionProvider>
              <LibraryCardsProvider items={[item]}>
                <LibraryCardGrid><LibraryCard item={item} /></LibraryCardGrid>
              </LibraryCardsProvider>
            </SelectionProvider>
          </RevealAllProvider>
        ),
      }],
      { initialEntries: ["/"] },
    )
    render(
      <QueryClientProvider client={trackClient(new QueryClient({ defaultOptions: { queries: { retry: false } } }))}>
        <TooltipProvider><RouterProvider router={router} /></TooltipProvider>
      </QueryClientProvider>,
    )
    await settleQueries()
    const box = screen.getByRole("checkbox", { name: "Select Clip" })
    expect(box).toHaveClass("pointer-coarse:opacity-100", "pointer-coarse:after:-inset-3.5", "pointer-coarse:after:absolute")
    expect(box).toHaveClass("opacity-0", "group-hover:opacity-100", "focus-visible:opacity-100", "absolute")
  })
})

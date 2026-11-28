import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BrowseHeader } from "@/components/browse/BrowseHeader"
import { CollectionTree } from "@/components/collections/CollectionTree"
import { MobileNav } from "@/components/sidebar/MobileNav"
import { TooltipProvider } from "@/components/ui/tooltip"
import { buildCollectionTree } from "@/lib/collectionTree"
import { expectControlsNamed } from "@/test/a11yNames"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import type { Collection } from "@/types/api"

// Icon-only controls carry only a tooltip, which a screen reader or TalkBack never gets (it opens on hover, never on touch):
// each one needs its own accessible name. These mount the cheap-to-mount surfaces and check every control has one.
beforeEach(() => {
  mockFetch(() => ({ status: 200, body: [] }))
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})

describe("Browse header", () => {
  it("names the search toggle and the Manage link, then the clear button once there is a query", async () => {
    const { container } = renderWithProviders(
      <TooltipProvider>
        <BrowseHeader />
      </TooltipProvider>,
      "/browse",
    )
    expectControlsNamed(container)
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/")

    await userEvent.click(screen.getByRole("button", { name: "Search" }))
    await userEvent.type(screen.getByRole("textbox"), "abc")
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy()
    expectControlsNamed(container)
  })
})

describe("Mobile navigation", () => {
  it("names the menu button and, once open, the close button", async () => {
    const { container } = renderWithProviders(
      <TooltipProvider>
        <MobileNav />
      </TooltipProvider>,
    )
    expectControlsNamed(container)
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }))
    expect(screen.getByRole("button", { name: "Close menu" })).toBeTruthy()
    expectControlsNamed(container)
  })
})

const collection = (id: number, name: string, parentId: number | null): Collection =>
  ({
    id,
    name,
    parentId,
    rootPath: name,
    path: name,
    defaultQuality: "best",
    defaultDownloadType: "video",
    filenameTemplate: "",
    isPrivate: false,
    effectiveIsPrivate: false,
    seasonNumber: null,
    year: null,
    sequenceMin: null,
    sequenceMax: null,
    artistId: null,
    itemCount: 2,
    totalItemCount: 2,
    ghostItemCount: 0,
    totalGhostItemCount: 0,
    browseAsShow: false,
  }) as unknown as Collection

describe("Collection tree", () => {
  const all = [collection(1, "Anime", null), collection(2, "Season One", 1), collection(3, "Music", null)]

  function renderTree(expanded: Set<number>) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TooltipProvider>
            <CollectionTree
              nodes={buildCollectionTree(all)}
              collections={all}
              isSelected={() => false}
              onToggle={() => {}}
              onRowMouseDown={() => {}}
              isExpanded={(id) => expanded.has(id)}
              onToggleExpanded={() => {}}
            />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it("names the row checkboxes, the expand toggle (with its state) and the row actions after their collection", () => {
    const { container } = renderTree(new Set([1]))
    expectControlsNamed(container)
    expect(screen.getByRole("checkbox", { name: "Select Anime" })).toBeTruthy()
    expect(screen.getByRole("checkbox", { name: "Select Season One" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Sub-collections of Anime" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.queryByRole("button", { name: "Sub-collections of Music" })).toBeNull()
    for (const name of ["Anime", "Music"]) {
      expect(screen.getByRole("button", { name: `Edit ${name}` })).toBeTruthy()
      expect(screen.getByRole("button", { name: `Delete ${name}` })).toBeTruthy()
      expect(screen.getByRole("button", { name: `Add sub-collection to ${name}` })).toBeTruthy()
    }
  })

  it("reports a collapsed node as not expanded", () => {
    renderTree(new Set())
    expect(screen.getByRole("button", { name: "Sub-collections of Anime" })).toHaveAttribute("aria-expanded", "false")
    expect(within(document.body).queryByRole("checkbox", { name: "Select Season One" })).toBeNull()
  })
})

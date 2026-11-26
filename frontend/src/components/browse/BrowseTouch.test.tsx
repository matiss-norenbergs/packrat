import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BrowseHeader } from "@/components/browse/BrowseHeader"
import { BrowseHero } from "@/components/browse/BrowseHero"
import { BrowseShowTile } from "@/components/browse/BrowseShowTile"
import { BrowseTile } from "@/components/browse/BrowseTile"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { ShowSummary } from "@/lib/browseShows"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import type { LibraryItem } from "@/types/api"

beforeEach(() => {
  localStorage.clear()
  mockFetch((url) => (url.endsWith("/settings") ? { status: 200, body: { privacyEnabled: false } } : { status: 404 }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ITEM = { id: 7, title: "Clip", blurred: false, status: "completed", mediaType: "video", thumbnailSmallPath: null } as unknown as LibraryItem

describe("Browse touch targets (pointer-coarse, 44px)", () => {
  it("the hero Play button and the header's home link, search and clear are at least 44px on touch", async () => {
    render(
      <MemoryRouter>
        <BrowseHero items={[ITEM]} />
      </MemoryRouter>,
    )
    expect(screen.getByRole("link", { name: /Play/ })).toHaveClass("pointer-coarse:min-h-11")

    renderWithProviders(
      <TooltipProvider>
        <BrowseHeader />
      </TooltipProvider>,
      "/browse?q=abc",
    )
    expect(screen.getByRole("link", { name: /Packrat/ })).toHaveClass("pointer-coarse:min-h-11")
    expect(screen.getByRole("button", { name: "Clear search" })).toHaveClass("pointer-coarse:size-11")
    expect(screen.getByRole("link", { name: "Manage" })).toHaveClass("pointer-coarse:size-11")
  })
})

describe("one tab stop per Browse tile", () => {
  it("a tile is the link, then the remove button; the title is plain text and never a stop", async () => {
    renderWithProviders(
      <TooltipProvider>
        <BrowseTile item={ITEM} progressFraction={0.5} onRemove={() => {}} />
      </TooltipProvider>,
    )
    expect(screen.getAllByRole("link")).toHaveLength(1)
    expect(screen.getByRole("link")).toHaveAttribute("href", "/browse/7")
    await userEvent.tab()
    expect(screen.getByRole("link", { name: "Clip" })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole("button", { name: "Remove" })).toHaveFocus()
    await userEvent.tab()
    expect(document.body).toHaveFocus()
    // The caption is not interactive.
    expect(screen.getByText("Clip", { selector: "p" }).closest("a,button,[tabindex]")).toBeNull()
  })

  it("a show tile is a single link", async () => {
    const show = { collectionId: 3, name: "Show", isPrivate: false, coverUrlSmall: null } as unknown as ShowSummary
    renderWithProviders(
      <TooltipProvider>
        <BrowseShowTile show={show} />
      </TooltipProvider>,
    )
    expect(screen.getAllByRole("link")).toHaveLength(1)
    await userEvent.tab()
    expect(screen.getByRole("link", { name: "Show" })).toHaveFocus()
    await userEvent.tab()
    expect(document.body).toHaveFocus()
  })

  it("the tile link covers the whole poster, so a tap anywhere on it navigates", async () => {
    renderWithProviders(
      <TooltipProvider>
        <BrowseTile item={ITEM} />
      </TooltipProvider>,
    )
    expect(screen.getByRole("link", { name: "Clip" })).toHaveClass("absolute", "inset-0")
  })
})

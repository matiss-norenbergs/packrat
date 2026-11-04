import { cleanup, render } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { LibraryItem } from "@/types/api"
import { LibraryCard } from "./LibraryCard"
import { RevealAllProvider } from "./RevealAllContext"
import { SelectionProvider } from "./SelectionContext"

vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ data: { privacyBlurStrength: "default" } }) }))
vi.mock("@/hooks/useTagNameMask", () => ({ useTagNameMask: () => (t: { name: string }) => t.name }))
vi.mock("@/hooks/useArtistNameMask", () => ({ useArtistNameMask: () => (n: string) => n }))
vi.mock("./LibraryItemActionsMenu", () => ({ LibraryItemActionsMenu: () => null }))

afterEach(cleanup)

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    id: 1,
    title: "T",
    filename: "f.mp4",
    path: "media/f.mp4",
    mediaType: "video",
    thumbnail: "thumbs/t.jpg",
    thumbnailMediumPath: null,
    blurred: false,
    tags: [],
    status: "ready",
    ...over,
  } as unknown as LibraryItem
}

function renderCard(i: LibraryItem) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <RevealAllProvider>
          <SelectionProvider>
            <LibraryCard item={i} />
          </SelectionProvider>
        </RevealAllProvider>
      </TooltipProvider>
    </MemoryRouter>,
  )
}

describe("LibraryCard ghost thumbnail", () => {
  it("renders a grayscale image for a ghost with a thumbnail", () => {
    const { container } = renderCard(item({ status: "ghost" }))
    const img = container.querySelector("img")
    expect(img).toHaveClass("grayscale", "hover:grayscale-0")
  })

  it("renders the placeholder with no filter for a ghost without a thumbnail", () => {
    const { container } = renderCard(item({ status: "ghost", thumbnail: null }))
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector(".grayscale")).toBeNull()
  })

  it("leaves a non-ghost thumbnail unfiltered", () => {
    const { container } = renderCard(item({}))
    const img = container.querySelector("img")
    expect(img).not.toBeNull()
    expect(img).not.toHaveClass("grayscale")
  })
})

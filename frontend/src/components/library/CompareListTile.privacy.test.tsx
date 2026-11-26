import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { hashText } from "@/lib/utils"
import { expectNoPrivateText } from "@/test/a11yNames"
import type { LibraryItem } from "@/types/api"
import { CompareListTile } from "./CompareListTile"
import { RevealAllProvider } from "./RevealAllContext"

// Same stand-in the other tiles' tests use: private artists hash until revealed.
vi.mock("@/hooks/useArtistNameMask", () => ({
  useArtistNameMask: () => (_id: number | null | undefined, name: string, revealed: boolean) => (revealed ? name : `#${name.length}-hidden`),
}))

afterEach(cleanup)

const item = (over: Partial<LibraryItem> = {}) =>
  ({ id: 1, title: "Secret Title", artistId: 4, artistName: "Secret Artist", uploader: "Some Uploader", filename: "a.mp4", path: "m/a.mp4", mediaType: "video", status: "completed", thumbnail: null, blurred: true, tags: [], ...over }) as unknown as LibraryItem

const tile = (i: LibraryItem) => (
  <TooltipProvider>
    <RevealAllProvider>
      <CompareListTile item={i} selected={false} canSelect onToggle={() => {}} onRemove={() => {}} />
    </RevealAllProvider>
  </TooltipProvider>
)

describe("CompareListTile artist masking", () => {
  it("shows no real artist text for a blurred, unrevealed item (DOM text and names)", () => {
    const { container } = render(tile(item()))
    expect(screen.getByText("#13-hidden")).toBeInTheDocument()
    expectNoPrivateText(container, "Secret Artist", "Secret Title")
    expect(hashText("Secret Title")).toBeTruthy()
  })

  it("reveals the artist together with the item", async () => {
    render(tile(item()))
    await userEvent.click(screen.getByRole("button", { name: /reveal title/i }))
    expect(screen.getByText("Secret Artist")).toBeInTheDocument()
  })

  it("leaves a public item unchanged, and the uploader fallback unmasked", () => {
    const { rerender } = render(tile(item({ blurred: false })))
    expect(screen.getByText("Secret Artist")).toBeInTheDocument()
    rerender(tile(item({ blurred: false, artistName: null, artistId: null })))
    expect(screen.getByText("Some Uploader")).toBeInTheDocument()
  })
})

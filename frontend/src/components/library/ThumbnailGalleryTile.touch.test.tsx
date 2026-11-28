import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { ThumbnailGalleryImage } from "@/types/api"
import { ThumbnailGalleryTile } from "./ThumbnailGalleryTile"

vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ data: {} }) }))

// The tile's hover buttons: the mouse reveal (hover / focus) stays as it was, and under pointer-coarse they are
// always visible with a 44 px tap area (a 26 px circle: 14 px icon + p-1.5, so a 9 px inset).
const IMG: ThumbnailGalleryImage = {
  id: 1, imagePath: "g/1.jpg", width: 640, height: 360, timestampSeconds: 3, isFavorite: false, createdAt: "2026-01-01",
}

function renderTile(image: ThumbnailGalleryImage = IMG) {
  render(
    <TooltipProvider>
      <ThumbnailGalleryTile
        image={image} index={0} manageMode={false} selected={false} applyDisabled={false}
        onSelect={vi.fn()} onOpen={vi.fn()} onApply={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()}
      />
    </TooltipProvider>,
  )
}

describe("ThumbnailGalleryTile touch targets", () => {
  it.each(["Set as thumbnail", "Add to favorites", "Remove from gallery"])("%s is always shown on touch with a 44 px hit area", (name) => {
    renderTile()
    const btn = screen.getByRole("button", { name })
    expect(btn).toHaveClass("pointer-coarse:opacity-100", "pointer-coarse:after:-inset-[9px]", "pointer-coarse:after:absolute")
    // the mouse path is unchanged
    expect(btn).toHaveClass("opacity-0", "group-hover:opacity-100", "focus-visible:opacity-100", "absolute")
    expect(btn).not.toHaveClass("pointer-coarse:relative")
  })

  it("a favorited tile's heart keeps no hover-only classes but still has the hit area", () => {
    renderTile({ ...IMG, isFavorite: true })
    const btn = screen.getByRole("button", { name: "Remove from favorites" })
    expect(btn).not.toHaveClass("opacity-0")
    expect(btn).toHaveClass("pointer-coarse:after:-inset-[9px]")
  })
})

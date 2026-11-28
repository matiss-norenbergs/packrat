import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { LibraryItem, ThumbnailGalleryImage } from "@/types/api"
import { ThumbnailGalleryDialog } from "./ThumbnailGalleryDialog"

// The gallery hooks are replaced so a test controls the data and sees the mutation calls; the grid, tiles, selection
// and viewer are the real ones.
const gallery = vi.hoisted(() => ({
  data: undefined as { images: unknown[] } | undefined,
  isLoading: false,
  apply: { mutate: vi.fn(), isPending: false },
  remove: { mutate: vi.fn(), isPending: false },
  favorite: { mutate: vi.fn(), isPending: false },
  favorites: { mutate: vi.fn(), isPending: false },
}))
vi.mock("@/hooks/useThumbnailGallery", () => ({
  useThumbnailGallery: () => ({ data: gallery.data, isLoading: gallery.isLoading }),
  useApplyThumbnailFromGallery: () => gallery.apply,
  useDeleteThumbnailGalleryImages: () => gallery.remove,
  useSetThumbnailGalleryFavorite: () => gallery.favorite,
  useSetThumbnailGalleryFavorites: () => gallery.favorites,
}))
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ data: {} }) }))
// Counts renders of a tile (its caption renders once per tile render).
const dimensionRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock("@/components/ThumbnailDimensionsValue", () => ({
  ThumbnailDimensionsValue: () => {
    dimensionRenders.count++
    return null
  },
}))

// Radix Select (the sort and filter pickers) calls these; jsdom has neither.
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= () => {}

const item = { id: 7, title: "Some video" } as LibraryItem

function image(id: number, over: Partial<ThumbnailGalleryImage> = {}): ThumbnailGalleryImage {
  return { id, imagePath: `g/${id}.jpg`, width: 1280, height: 720, timestampSeconds: null, isFavorite: false, createdAt: "", ...over }
}

// Displayed order under the default sort (frame time ascending, then date saved): 2, 5, 4, 1, 3.
const IMAGES = [
  image(1, { timestampSeconds: 30 }),
  image(2, { timestampSeconds: 10 }),
  image(3),
  image(4, { timestampSeconds: 20, isFavorite: true }),
  image(5, { timestampSeconds: 10 }),
]
const DEFAULT_ORDER = [2, 5, 4, 1, 3]

function renderDialog() {
  const user = userEvent.setup()
  render(
    <TooltipProvider>
      <ThumbnailGalleryDialog item={item} open onOpenChange={() => {}} />
    </TooltipProvider>,
  )
  return user
}

// The ids of the tiles in the order they are in the DOM.
const tileIds = () => screen.getAllByAltText("Saved thumbnail").map((img) => Number(/g\/(\d+)\.jpg/.exec(decodeURIComponent(img.getAttribute("src") ?? ""))?.[1]))
const region = () => document.querySelector<HTMLElement>("[data-focus-region]")!
// In manage mode every tile is a checkbox, in displayed order.
const manageTiles = () => screen.getAllByRole("checkbox")
const selectedIds = () => manageTiles().flatMap((tile, i) => (tile.getAttribute("aria-checked") === "true" ? [DEFAULT_ORDER[i]] : []))

beforeEach(() => {
  gallery.data = { images: IMAGES }
  gallery.isLoading = false
  for (const m of [gallery.apply, gallery.remove, gallery.favorite, gallery.favorites]) {
    m.mutate.mockReset()
    m.isPending = false
  }
})

describe("states", () => {
  it("shows skeletons while loading, and neither tiles nor an empty message", () => {
    gallery.data = undefined
    gallery.isLoading = true
    renderDialog()
    expect(region().querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4)
    expect(screen.queryByAltText("Saved thumbnail")).not.toBeInTheDocument()
    expect(screen.queryByText(/No images/)).not.toBeInTheDocument()
  })

  it("says nothing is saved yet for an empty gallery", () => {
    gallery.data = { images: [] }
    renderDialog()
    expect(screen.getByText(/No images saved yet — use "Save in Thumbnail Gallery"/)).toBeInTheDocument()
    expect(screen.queryByText("No images match this filter.")).not.toBeInTheDocument()
  })

  it("says no images match when the filter hides them all", async () => {
    gallery.data = { images: [image(1), image(2)] }
    const user = renderDialog()
    await user.click(screen.getByRole("combobox", { name: "Filter gallery" }))
    await user.click(await screen.findByRole("option", { name: "Favorites only" }))
    expect(await screen.findByText("No images match this filter.")).toBeInTheDocument()
    expect(screen.queryByText(/No images saved yet/)).not.toBeInTheDocument()
    expect(screen.queryByAltText("Saved thumbnail")).not.toBeInTheDocument()
  })
})

describe("order, filter and scroll", () => {
  it("renders the tiles in the sorted order, not the API order", () => {
    renderDialog()
    expect(tileIds()).toEqual(DEFAULT_ORDER)
  })

  it("reorders and goes back to the top when the direction changes", async () => {
    const user = renderDialog()
    region().scrollTop = 200
    await user.click(screen.getByRole("button", { name: "Ascending" }))
    expect(tileIds()).toEqual([1, 4, 5, 2, 3]) // descending: 30, 20, 10 (newest id first), the untimed one still last
    expect(region().scrollTop).toBe(0)
  })

  it("filters and goes back to the top when the filter changes", async () => {
    const user = renderDialog()
    region().scrollTop = 200
    await user.click(screen.getByRole("combobox", { name: "Filter gallery" }))
    await user.click(await screen.findByRole("option", { name: "Favorites only" }))
    expect(tileIds()).toEqual([4])
    expect(region().scrollTop).toBe(0)
  })

  it("goes back to the top when the sort changes", async () => {
    const user = renderDialog()
    region().scrollTop = 200
    await user.click(screen.getByRole("combobox", { name: "Sort gallery" }))
    await user.click(await screen.findByRole("option", { name: "Date saved" }))
    expect(tileIds()).toEqual([5, 4, 3, 2, 1]) // newest saved first
    expect(region().scrollTop).toBe(0)
  })

  it("keeps the scroll when only the selection changes", async () => {
    const user = renderDialog()
    await user.click(screen.getByRole("switch"))
    region().scrollTop = 200
    await user.click(manageTiles()[1])
    expect(selectedIds()).toEqual([5]) // positive sentinel: the click was handled
    expect(region().scrollTop).toBe(200)
  })
})

describe("manage mode", () => {
  async function manage() {
    const user = renderDialog()
    await user.click(screen.getByRole("switch"))
    return user
  }

  it("toggles a tile on click", async () => {
    const user = await manage()
    await user.click(manageTiles()[0])
    expect(selectedIds()).toEqual([2])
    expect(screen.getByText("1 selected")).toBeInTheDocument()
    await user.click(manageTiles()[0])
    expect(selectedIds()).toEqual([])
    expect(screen.getByText("0 selected")).toBeInTheDocument()
  })

  it("selects the range between two tiles on shift-click, in displayed order", async () => {
    const user = await manage()
    await user.click(manageTiles()[1])
    await user.keyboard("{Shift>}")
    await user.click(manageTiles()[3])
    await user.keyboard("{/Shift}")
    expect(selectedIds()).toEqual([5, 4, 1])
    expect(screen.getByText("3 selected")).toBeInTheDocument()
  })

  it("selects a backwards range too", async () => {
    const user = await manage()
    await user.click(manageTiles()[3])
    await user.keyboard("{Shift>}")
    await user.click(manageTiles()[1])
    await user.keyboard("{/Shift}")
    expect(selectedIds()).toEqual([5, 4, 1])
  })

  it("toggles with Space and Enter", async () => {
    const user = await manage()
    manageTiles()[2].focus()
    await user.keyboard(" ")
    expect(selectedIds()).toEqual([4])
    await user.keyboard("{Enter}")
    expect(selectedIds()).toEqual([])
    await user.keyboard("{Enter}")
    expect(selectedIds()).toEqual([4])
  })

  it("selects all and clears", async () => {
    const user = await manage()
    await user.click(screen.getByRole("button", { name: "Select all" }))
    expect(selectedIds()).toEqual(DEFAULT_ORDER)
    expect(screen.getByText("5 selected")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Deselect all" }))
    expect(selectedIds()).toEqual([])
    expect(screen.getByText("0 selected")).toBeInTheDocument()
  })

  it("does not open the viewer, and leaves the hover buttons out", async () => {
    const user = await manage()
    await user.click(manageTiles()[0])
    expect(screen.getAllByRole("checkbox")).toHaveLength(5) // still one dialog, no viewer
    expect(screen.queryByRole("button", { name: "Set as thumbnail" })).not.toBeInTheDocument()
  })
})

describe("viewing and per-tile actions", () => {
  it("opens the viewer at the clicked tile's place in the displayed list", async () => {
    const user = renderDialog()
    await user.click(screen.getAllByAltText("Saved thumbnail")[3]) // displayed 4th: image id 1
    expect(await screen.findByText(/^4 \/ 5/)).toBeInTheDocument()
    await user.keyboard("{ArrowRight}")
    expect(await screen.findByText(/^5 \/ 5/)).toBeInTheDocument()
  })

  it("opens the viewer at the right index after a re-sort", async () => {
    const user = renderDialog()
    await user.click(screen.getByRole("button", { name: "Ascending" }))
    await user.click(screen.getAllByAltText("Saved thumbnail")[0]) // descending: first is id 1
    expect(await screen.findByText(/^1 \/ 5/)).toBeInTheDocument()
  })

  it("sets the clicked tile as the thumbnail", async () => {
    const user = renderDialog()
    await user.click(screen.getAllByRole("button", { name: "Set as thumbnail" })[1]) // displayed 2nd: id 5
    expect(gallery.apply.mutate).toHaveBeenCalledExactlyOnceWith({ id: 7, galleryId: 5 })
  })

  it("favorites a tile, and unfavorites a favorite", async () => {
    const user = renderDialog()
    await user.click(screen.getAllByRole("button", { name: "Add to favorites" })[0]) // id 2
    expect(gallery.favorite.mutate).toHaveBeenLastCalledWith({ id: 7, galleryId: 2, isFavorite: true })
    await user.click(screen.getByRole("button", { name: "Remove from favorites" })) // id 4
    expect(gallery.favorite.mutate).toHaveBeenLastCalledWith({ id: 7, galleryId: 4, isFavorite: false })
    expect(gallery.favorite.mutate).toHaveBeenCalledTimes(2)
  })

  it("asks before removing a tile, and removes it on confirm", async () => {
    const user = renderDialog()
    await user.click(screen.getAllByRole("button", { name: "Remove from gallery" })[2]) // id 4
    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText("Remove this image from the gallery?")).toBeInTheDocument()
    expect(gallery.remove.mutate).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole("button", { name: "Remove" }))
    expect(gallery.remove.mutate).toHaveBeenCalledExactlyOnceWith({ id: 7, galleryIds: [4] })
  })

  it("does not remove when the confirmation is cancelled", async () => {
    const user = renderDialog()
    await user.click(screen.getAllByRole("button", { name: "Remove from gallery" })[0])
    const confirm = await screen.findByRole("alertdialog")
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument() // sentinel: the dialog closed
    expect(gallery.remove.mutate).not.toHaveBeenCalled()
  })
})

describe("renderItem stability", () => {
  it("re-renders only the tile whose selection changed", async () => {
    const user = renderDialog()
    await user.click(screen.getByRole("switch")) // manage mode: every tile re-renders once
    const afterModeChange = dimensionRenders.count
    await user.click(manageTiles()[0])
    expect(selectedIds()).toEqual([2]) // sentinel: the click was handled
    expect(dimensionRenders.count - afterModeChange).toBe(1)
  })
})

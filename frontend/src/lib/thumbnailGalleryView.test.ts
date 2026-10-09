import { describe, expect, it } from "vitest"
import type { ThumbnailGalleryImage } from "@/types/api"
import { applyGalleryView } from "./thumbnailGalleryView"

const img = (id: number, timestampSeconds: number | null, isFavorite = false): ThumbnailGalleryImage => ({
  id,
  imagePath: `p/${id}.jpg`,
  width: null,
  height: null,
  timestampSeconds,
  isFavorite,
  createdAt: "",
})

const images = [img(1, 30), img(2, null, true), img(3, 5), img(4, null), img(5, 5, true)]
const ids = (list: ThumbnailGalleryImage[]) => list.map((i) => i.id)

describe("applyGalleryView", () => {
  it("sorts by date saved in either direction", () => {
    expect(ids(applyGalleryView(images, "saved", "desc", "all"))).toEqual([5, 4, 3, 2, 1])
    expect(ids(applyGalleryView(images, "saved", "asc", "all"))).toEqual([1, 2, 3, 4, 5])
  })

  it("sorts by frame time with untimed images last in both directions", () => {
    expect(ids(applyGalleryView(images, "frame-time", "asc", "all"))).toEqual([5, 3, 1, 4, 2])
    expect(ids(applyGalleryView(images, "frame-time", "desc", "all"))).toEqual([1, 5, 3, 4, 2])
  })

  it("sorts favorites first (desc) or last (asc), newest within each group", () => {
    expect(ids(applyGalleryView(images, "favorites", "desc", "all"))).toEqual([5, 2, 4, 3, 1])
    expect(ids(applyGalleryView(images, "favorites", "asc", "all"))).toEqual([4, 3, 1, 5, 2])
  })

  it("filters to favorites or images with a frame time", () => {
    expect(ids(applyGalleryView(images, "saved", "desc", "favorites"))).toEqual([5, 2])
    expect(ids(applyGalleryView(images, "saved", "desc", "with-time"))).toEqual([5, 3, 1])
  })

  it("does not mutate its input", () => {
    const copy = [...images]
    applyGalleryView(images, "saved", "asc", "all")
    expect(images).toEqual(copy)
  })
})

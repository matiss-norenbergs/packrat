import type { ThumbnailGalleryImage } from "@/types/api"

export type GallerySort = "frame-time-saved" | "saved" | "frame-time" | "favorites"
export type GallerySortDirection = "asc" | "desc"
export type GalleryFilter = "all" | "favorites" | "with-time"

// The direction each sort starts in when picked: newest saved first, earliest
// frame first, favorites first.
export const defaultSortDirection: Record<GallerySort, GallerySortDirection> = {
  "frame-time-saved": "asc",
  saved: "desc",
  "frame-time": "asc",
  favorites: "desc",
}

// The API returns images newest first (id DESC); ids are monotonic, so
// comparing ids gives the same order without parsing createdAt.
const byNewest = (a: ThumbnailGalleryImage, b: ThumbnailGalleryImage) => b.id - a.id

// galleryIdRange returns the ids from anchorId to targetId (inclusive, in
// displayed order, whichever comes first) for shift-click range selection. If
// either end isn't in the list — the anchor was filtered out since — it falls
// back to just the target.
export function galleryIdRange(images: ThumbnailGalleryImage[], anchorId: number, targetId: number): number[] {
  const a = images.findIndex((i) => i.id === anchorId)
  const b = images.findIndex((i) => i.id === targetId)
  if (a < 0 || b < 0) return [targetId]
  const [from, to] = a <= b ? [a, b] : [b, a]
  return images.slice(from, to + 1).map((i) => i.id)
}

// applyGalleryView filters then sorts a gallery's images for display.
// "asc" means oldest saved / earliest frame / non-favorites first. Images
// without a frame time (older rows, copies of an existing thumbnail) always
// sort after every timed one under "frame-time" and "frame-time-saved",
// whatever the direction. "frame-time" breaks ties newest first;
// "frame-time-saved" breaks them by date saved in the same direction (so
// ascending is earliest frame, then oldest saved) and orders the untimed
// images by date saved too.
export function applyGalleryView(
  images: ThumbnailGalleryImage[],
  sort: GallerySort,
  direction: GallerySortDirection,
  filter: GalleryFilter,
): ThumbnailGalleryImage[] {
  const filtered = images.filter((img) => {
    if (filter === "favorites") return img.isFavorite
    if (filter === "with-time") return img.timestampSeconds != null
    return true
  })
  const sign = direction === "asc" ? 1 : -1

  return [...filtered].sort((a, b) => {
    switch (sort) {
      case "frame-time-saved": {
        if (a.timestampSeconds == null && b.timestampSeconds == null) return sign * (a.id - b.id)
        if (a.timestampSeconds == null) return 1
        if (b.timestampSeconds == null) return -1
        return sign * (a.timestampSeconds - b.timestampSeconds) || sign * (a.id - b.id)
      }
      case "frame-time": {
        if (a.timestampSeconds == null && b.timestampSeconds == null) return byNewest(a, b)
        if (a.timestampSeconds == null) return 1
        if (b.timestampSeconds == null) return -1
        return sign * (a.timestampSeconds - b.timestampSeconds) || byNewest(a, b)
      }
      case "favorites":
        return sign * (Number(a.isFavorite) - Number(b.isFavorite)) || byNewest(a, b)
      default:
        return sign * (a.id - b.id)
    }
  })
}

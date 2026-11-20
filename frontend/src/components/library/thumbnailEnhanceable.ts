import type { LibraryItem } from "@/types/api"

/**
 * Whether AI enhancement / sharpening applies to an item's thumbnail. An image item's thumbnail IS the image file
 * itself, which enhancement must never overwrite (the server answers 400 / skips it), so the actions are hidden.
 */
export const canEnhanceThumbnail = (item: Pick<LibraryItem, "mediaType">) => item.mediaType !== "image"

/**
 * The bulk "Sharpen thumbnail(s)…" entry is offered unless the selection is made up of image items only (a selected
 * collection may hold anything, so it keeps the entry; the dialog drops image items itself).
 */
export function bulkSharpenAvailable(selectedItems: Iterable<Pick<LibraryItem, "mediaType">>, collectionCount: number): boolean {
  if (collectionCount > 0) return true
  let any = false
  for (const item of selectedItems) {
    any = true
    if (canEnhanceThumbnail(item)) return true
  }
  return !any
}

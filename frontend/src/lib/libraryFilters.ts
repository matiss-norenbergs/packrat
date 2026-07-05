import type { LibraryItem } from "@/types/api"

export type LibrarySortKey = "downloadedAt" | "title" | "filename" | "year" | "duration"
export type LibrarySortDir = "asc" | "desc"

export function searchLibraryItems(items: LibraryItem[], search: string): LibraryItem[] {
  const q = search.trim().toLowerCase()
  if (!q) return items
  return items.filter((item) =>
    [item.title, item.uploader, item.artist, item.description].some((field) => field?.toLowerCase().includes(q)),
  )
}

function compareValues(a: string | number | null, b: string | number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1 // nulls sort last regardless of direction
  if (b == null) return -1
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b)
  return (a as number) - (b as number)
}

export function sortLibraryItems(items: LibraryItem[], sortKey: LibrarySortKey, sortDir: LibrarySortDir): LibraryItem[] {
  const sorted = [...items].sort((a, b) => {
    switch (sortKey) {
      case "title":
        return compareValues(a.title, b.title)
      case "filename":
        return compareValues(a.filename, b.filename)
      case "year":
        return compareValues(a.year, b.year)
      case "duration":
        return compareValues(a.duration, b.duration)
      case "downloadedAt":
      default:
        return compareValues(a.downloadedAt, b.downloadedAt)
    }
  })
  return sortDir === "desc" ? sorted.reverse() : sorted
}

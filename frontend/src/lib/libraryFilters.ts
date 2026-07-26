import type { LibraryItem } from "@/types/api"

export type LibrarySortKey = "downloadedAt" | "title" | "filename" | "year" | "duration" | "sequenceNumber" | "seasonNumber"
export type LibrarySortDir = "asc" | "desc"

// dir only flips the sign of an actual value comparison — the null-handling
// branches stay direction-independent so a null always sorts last, in both
// asc and desc. (Previously this was done by sorting ascending and then
// reversing the whole array for desc, which put nulls first instead of
// last on any descending sort.)
function compareValues(a: string | number | null, b: string | number | null, dir: 1 | -1): number {
  if (a == null && b == null) return 0
  if (a == null) return 1 // nulls sort last regardless of direction
  if (b == null) return -1
  if (typeof a === "string" && typeof b === "string") return dir * a.localeCompare(b)
  return dir * ((a as number) - (b as number))
}

export function sortLibraryItems(items: LibraryItem[], sortKey: LibrarySortKey, sortDir: LibrarySortDir): LibraryItem[] {
  const dir = sortDir === "desc" ? -1 : 1
  return [...items].sort((a, b) => {
    switch (sortKey) {
      case "title":
        return compareValues(a.title, b.title, dir)
      case "filename":
        return compareValues(a.filename, b.filename, dir)
      case "year":
        return compareValues(a.year, b.year, dir)
      case "duration":
        return compareValues(a.duration, b.duration, dir)
      case "sequenceNumber":
        return compareValues(a.sequenceNumber, b.sequenceNumber, dir)
      case "seasonNumber": {
        // Season first, sequence (episode) as the tiebreaker within a
        // season — matches the backend's compound ORDER BY for this key.
        const seasonCmp = compareValues(a.seasonNumber, b.seasonNumber, dir)
        return seasonCmp !== 0 ? seasonCmp : compareValues(a.sequenceNumber, b.sequenceNumber, dir)
      }
      case "downloadedAt":
      default:
        return compareValues(a.downloadedAt, b.downloadedAt, dir)
    }
  })
}

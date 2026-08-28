import { createContext, useContext, useState, type ReactNode } from "react"
import type { LibrarySortKey } from "@/lib/libraryFilters"

export type LibraryColumnKey = "seasonEpisode" | "year" | "duration" | "downloadedAt" | "artist" | "collection" | "size" | "tags"

// Single source of truth for the list view's optional columns — order here
// is render order (left to right) for both the header row and the "Columns"
// toggle menu. sortKey, when present, makes the header clickable; columns
// without one (artist/collection/size/tags) aren't backed by a single sortable
// SQL column. headerClassName/cellClassName let a column request its own
// width/truncation without every other column needing the same treatment.
// defaultVisible false keeps the table narrow out of the box — those columns
// are one click away in the Columns menu, not gone.
export const LIBRARY_COLUMNS: {
  key: LibraryColumnKey
  label: string
  sortKey?: LibrarySortKey
  headerClassName?: string
  cellClassName?: string
  defaultVisible?: boolean
}[] = [
  { key: "seasonEpisode", label: "Season/Episode", sortKey: "seasonNumber", headerClassName: "w-36 text-right", cellClassName: "text-right" },
  { key: "year", label: "Year", sortKey: "year", headerClassName: "w-20 text-right", cellClassName: "text-right", defaultVisible: false },
  { key: "duration", label: "Duration", sortKey: "duration", headerClassName: "w-24 text-right", cellClassName: "text-right", defaultVisible: false },
  { key: "downloadedAt", label: "Downloaded", sortKey: "downloadedAt", headerClassName: "w-32 text-center", cellClassName: "text-center", defaultVisible: false },
  { key: "artist", label: "Artist", cellClassName: "max-w-40 truncate" },
  { key: "collection", label: "Collection", cellClassName: "max-w-40 truncate" },
  { key: "size", label: "Size", headerClassName: "w-20 text-right", cellClassName: "text-right", defaultVisible: false },
  { key: "tags", label: "Tags" },
]

const DEFAULT_VISIBLE_COLUMN_KEYS = new Set(
  LIBRARY_COLUMNS.filter((c) => c.defaultVisible !== false).map((c) => c.key),
)

interface LibraryColumnsContextValue {
  visibleColumns: Set<LibraryColumnKey>
  toggleColumn: (key: LibraryColumnKey) => void
}

const LibraryColumnsContext = createContext<LibraryColumnsContextValue>({
  visibleColumns: DEFAULT_VISIBLE_COLUMN_KEYS,
  toggleColumn: () => {},
})

// Session-only (not persisted) column visibility for the Library page's list
// view — mirrors RevealAllContext.tsx's shape. Provided above both
// LibraryToolbar (which renders the "Columns" toggle menu) and
// LibraryListView (which reads it to decide what to render), since the menu
// lives in the shared toolbar while only list view has columns to toggle.
export function LibraryColumnsProvider({ children }: { children: ReactNode }) {
  const [visibleColumns, setVisibleColumns] = useState<Set<LibraryColumnKey>>(new Set(DEFAULT_VISIBLE_COLUMN_KEYS))

  const toggleColumn = (key: LibraryColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return <LibraryColumnsContext.Provider value={{ visibleColumns, toggleColumn }}>{children}</LibraryColumnsContext.Provider>
}

export function useLibraryColumns() {
  return useContext(LibraryColumnsContext)
}

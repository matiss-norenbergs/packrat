import { createContext, useContext, useMemo } from "react"
import { useTableLayouts } from "@/hooks/useTableLayout"
import type { SortState } from "@/components/data-table/sorting"
import type { LibrarySortDir, LibrarySortKey } from "@/lib/libraryFilters"

export const LIBRARY_SORT_KEYS: readonly LibrarySortKey[] = ["downloadedAt", "title", "filename", "year", "duration", "sequenceNumber", "seasonNumber"]
export const LIBRARY_TABLE_ID = "library"

export interface LibrarySort {
  key: LibrarySortKey
  dir: LibrarySortDir
}

export const DEFAULT_LIBRARY_SORT: LibrarySort = { key: "downloadedAt", dir: "desc" }

export interface LibrarySortValue {
  /** The sort every Library view uses now. */
  sort: LibrarySort
  /** What a reload starts with: the sort of the account's saved `library` layout, else the built-in default. */
  baseline: LibrarySort
  /** The layouts have answered (or failed, meaning the default applies); Library queries wait for it. */
  ready: boolean
  /** The working sort differs from the baseline. */
  differs: boolean
  setSort: (sort: LibrarySort) => void
  /** Stores only the sort (default: the working one) in the saved `library` layout. Resolves true when stored. */
  saveSortAsDefault: (sort?: LibrarySort) => Promise<boolean>
}

export const LibrarySortContext = createContext<LibrarySortValue | null>(null)

export function toLibrarySort(sort: SortState | undefined): LibrarySort {
  return sort && LIBRARY_SORT_KEYS.includes(sort.key as LibrarySortKey) ? (sort as LibrarySort) : DEFAULT_LIBRARY_SORT
}

/**
 * The Library sort. Inside LibrarySortProvider (AppLayout) it is the shared working sort. Outside it (Browse has none
 * of AppLayout's providers) it is the saved `library` layout's sort or the built-in default, read-only: setSort and
 * saveSortAsDefault do nothing.
 */
export function useLibrarySort(): LibrarySortValue {
  const ctx = useContext(LibrarySortContext)
  const { data: layouts, isPending } = useTableLayouts()
  const savedSort = layouts?.[LIBRARY_TABLE_ID]?.sort
  const savedKey = savedSort?.key
  const savedDir = savedSort?.dir
  const fallback = useMemo<LibrarySortValue>(() => {
    const sort = toLibrarySort(savedKey && savedDir ? { key: savedKey, dir: savedDir } : undefined)
    return { sort, baseline: sort, ready: !isPending, differs: false, setSort: () => {}, saveSortAsDefault: async () => false }
  }, [savedKey, savedDir, isPending])
  return ctx ?? fallback
}

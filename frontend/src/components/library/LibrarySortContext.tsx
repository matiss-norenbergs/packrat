import { useCallback, useMemo, type ReactNode } from "react"
import { sameSort } from "@/components/data-table/sorting"
import { DEFAULT_LIBRARY_SORT, LIBRARY_SORT_KEYS, LIBRARY_TABLE_ID, LibrarySortContext, toLibrarySort, type LibrarySort, type LibrarySortValue } from "@/hooks/useLibrarySort"
import { useSaveTableLayoutSort, useTableLayout } from "@/hooks/useTableLayout"

/**
 * The Library's working sort, shared by the grid, the folder view, the list view, the toolbar dialog and the item page
 * strip. It sits in AppLayout so it survives navigation between /library and /library/:id; it applies instantly, is
 * never saved automatically and starts again from the baseline (the saved `library` layout's sort, else the default) on
 * a reload. Read it with useLibrarySort().
 */
export function LibrarySortProvider({ children }: { children: ReactNode }) {
  const layout = useTableLayout(LIBRARY_TABLE_ID, { v: 1 }, { knownKeys: LIBRARY_SORT_KEYS, sortableKeys: LIBRARY_SORT_KEYS, defaultSort: DEFAULT_LIBRARY_SORT })
  const save = useSaveTableLayoutSort(LIBRARY_TABLE_ID, DEFAULT_LIBRARY_SORT, "Default sort saved")
  const { setWorking, working, baseline: baselineLayout, ready } = layout

  const sort = toLibrarySort(working.sort)
  const baseline = toLibrarySort(baselineLayout.sort)
  const { key: sortKey, dir: sortDir } = sort
  const { key: baselineKey, dir: baselineDir } = baseline

  const setSort = useCallback((next: LibrarySort) => setWorking((prev) => ({ ...prev, sort: { key: next.key, dir: next.dir } })), [setWorking])
  const saveSortAsDefault = useCallback((next?: LibrarySort) => save(next ?? { key: sortKey, dir: sortDir }), [save, sortKey, sortDir])

  const value = useMemo<LibrarySortValue>(
    () => ({
      sort: { key: sortKey, dir: sortDir },
      baseline: { key: baselineKey, dir: baselineDir },
      ready,
      differs: !sameSort({ key: sortKey, dir: sortDir }, { key: baselineKey, dir: baselineDir }),
      setSort,
      saveSortAsDefault,
    }),
    [sortKey, sortDir, baselineKey, baselineDir, ready, setSort, saveSortAsDefault],
  )
  return <LibrarySortContext.Provider value={value}>{children}</LibrarySortContext.Provider>
}

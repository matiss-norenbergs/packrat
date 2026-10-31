import { useCallback, useMemo, type ReactNode } from "react"
import type { TableLayout } from "@/types/api"
import { sameSort } from "@/components/data-table/sorting"
import { DEFAULT_LIBRARY_SORT, LIBRARY_TABLE_ID, LibrarySortContext, toLibrarySort, type LibrarySort, type LibrarySortValue } from "@/hooks/useLibrarySort"
import { useSaveTableLayoutSort, useTableLayout } from "@/hooks/useTableLayout"
import { LIBRARY_LIST_DEFAULT_LAYOUT, LIBRARY_LIST_LAYOUT_OPTIONS } from "@/lib/libraryListColumns"

/**
 * The Library's working sort, shared by the grid, the folder view, the list view, the toolbar dialog and the item page
 * strip. It sits in AppLayout so it survives navigation between /library and /library/:id; it applies instantly, is
 * never saved automatically and starts again from the baseline (the saved `library` layout's sort, else the default) on
 * a reload. Read it with useLibrarySort().
 *
 * It carries the table's FULL working layout (sort, hidden columns, widths), not only the sort: the list view's DataTable
 * edits it through `layout` / `onLayoutChange`, and the layout is normalized against the list's column specs
 * (lib/libraryListColumns.ts), which is what keeps a saved layout's `hidden` and `widths` instead of dropping them. A stored layout
 * with no `hidden` key (one saved for its sort only) hides the default columns; an explicit `hidden` wins.
 */
export function LibrarySortProvider({ children }: { children: ReactNode }) {
  const layout = useTableLayout(LIBRARY_TABLE_ID, LIBRARY_LIST_DEFAULT_LAYOUT, { ...LIBRARY_LIST_LAYOUT_OPTIONS, defaultSort: DEFAULT_LIBRARY_SORT, hiddenWhenUnset: LIBRARY_LIST_DEFAULT_LAYOUT.hidden })
  const save = useSaveTableLayoutSort(LIBRARY_TABLE_ID, DEFAULT_LIBRARY_SORT, "Default sort saved")
  const { setWorking, working, baseline: baselineLayout, ready } = layout

  const sort = toLibrarySort(working.sort)
  const baseline = toLibrarySort(baselineLayout.sort)
  const { key: sortKey, dir: sortDir } = sort
  const { key: baselineKey, dir: baselineDir } = baseline

  const setLayout = useCallback((next: TableLayout) => setWorking(next), [setWorking])
  const setSort = useCallback((next: LibrarySort) => setWorking((prev) => ({ ...prev, sort: { key: next.key, dir: next.dir } })), [setWorking])
  const saveSortAsDefault = useCallback((next?: LibrarySort) => save(next ?? { key: sortKey, dir: sortDir }), [save, sortKey, sortDir])

  const value = useMemo<LibrarySortValue>(
    () => ({
      sort: { key: sortKey, dir: sortDir },
      baseline: { key: baselineKey, dir: baselineDir },
      ready,
      differs: !sameSort({ key: sortKey, dir: sortDir }, { key: baselineKey, dir: baselineDir }),
      setSort,
      layout: working,
      setLayout,
      saveSortAsDefault,
    }),
    [sortKey, sortDir, baselineKey, baselineDir, ready, setSort, working, setLayout, saveSortAsDefault],
  )
  return <LibrarySortContext.Provider value={value}>{children}</LibrarySortContext.Provider>
}

import { columnMinWidth, columnWidth, isResizable } from "@/components/data-table/columns"
import type { ColumnWidthSpec } from "@/components/data-table/columns"
import type { LibrarySortKey } from "@/lib/libraryFilters"
import type { TableLayout } from "@/types/api"

/**
 * Single source of truth for the Library list view's columns: the list's column definitions (LibraryListView) and the
 * shared Library layout (LibrarySortProvider's `useTableLayout("library", ...)`) are both built from it. The provider
 * lives above the page and cannot see the columns, but its normalization must know which keys are hideable, sortable
 * and resizable, otherwise a saved layout's `hidden` and `widths` would be dropped on load and lost on Restore.
 * No JSX and no component imports, so both sides can import it without a cycle.
 *
 * A sortable column's key IS the server sort key (`LibrarySortKey`), so `layout.sort.key` is what the queries send.
 */
export interface LibraryColumnSpec extends ColumnWidthSpec {
  key: string
  /** Header text and the name in the Columns menu. */
  label: string
  hideable?: boolean
  /** Hideable columns only; default true. */
  defaultVisible?: boolean
  /** The header sorts on the server by `key` (a `LibrarySortKey`). */
  sortable?: boolean
}

// Order is the render order, left to right.
export const LIBRARY_LIST_COLUMN_SPECS: readonly LibraryColumnSpec[] = [
  { key: "thumb", label: "Thumb", width: 80, resizable: false },
  { key: "title", label: "Title", flex: true, width: 280, sortable: true },
  { key: "seasonNumber", label: "Season/Episode", type: "number", width: 150, hideable: true, sortable: true },
  { key: "year", label: "Year", type: "number", width: 90, hideable: true, defaultVisible: false, sortable: true },
  { key: "duration", label: "Duration", type: "number", width: 110, hideable: true, defaultVisible: false, sortable: true },
  { key: "downloadedAt", label: "Downloaded", type: "date", width: 130, hideable: true, defaultVisible: false, sortable: true },
  { key: "artist", label: "Artist", width: 200, hideable: true },
  { key: "collection", label: "Collection", width: 200, hideable: true },
  { key: "size", label: "Size", type: "number", width: 110, hideable: true, defaultVisible: false },
  { key: "tags", label: "Tags", width: 280, hideable: true },
  { key: "actions", label: "Actions", type: "icon", width: 56, resizable: false },
]

/** Sort keys the toolbar's Filters & Sort dialog offers that have no column. */
export const LIBRARY_LIST_EXTRA_SORT_KEYS: readonly LibrarySortKey[] = ["filename", "sequenceNumber"]

/** The layout of a table whose user never touched it: hideable columns with `defaultVisible: false` are hidden. */
export const LIBRARY_LIST_DEFAULT_LAYOUT: TableLayout = {
  v: 1,
  hidden: LIBRARY_LIST_COLUMN_SPECS.filter((c) => c.hideable && c.defaultVisible === false).map((c) => c.key),
}

/** What `useTableLayout` needs to normalize the `library` layout (see `TableLayoutOptions`). */
export const LIBRARY_LIST_LAYOUT_OPTIONS = {
  knownKeys: [...LIBRARY_LIST_COLUMN_SPECS.map((c) => c.key), ...LIBRARY_LIST_EXTRA_SORT_KEYS],
  hideableKeys: LIBRARY_LIST_COLUMN_SPECS.filter((c) => c.hideable).map((c) => c.key),
  sortableKeys: [...LIBRARY_LIST_COLUMN_SPECS.filter((c) => c.sortable).map((c) => c.key), ...LIBRARY_LIST_EXTRA_SORT_KEYS],
  resizableWidths: Object.fromEntries(
    LIBRARY_LIST_COLUMN_SPECS.filter(isResizable).map((c) => [c.key, { default: columnWidth(c), min: columnMinWidth(c) }]),
  ),
} as const

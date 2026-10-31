import type { ReactNode } from "react"
import type { SortValue } from "./sorting"

export type RowId = string | number

export type ColumnType = "text" | "number" | "date" | "status" | "icon" | "switch"
export type ColumnAlign = "left" | "center" | "right"

export interface ColumnDef<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** Drives the default alignment: date/status/switch/icon center, number right, text (default) left. */
  type?: ColumnType
  /** Overrides the alignment preset for the header and the cells. */
  align?: ColumnAlign
  /** Exact column width in px; default by `type` (text 200, number 110, date 180, status 130, icon 64, switch 96). */
  width?: number
  /** Lower bound in px (default 48); the column is never laid out narrower. */
  minWidth?: number
  /**
   * Opt-in: this column absorbs the spare width, and the table then has no filler column. A flex column gets no colgroup
   * width, so with several of them the browser splits the spare width EQUALLY between them, not in proportion to their
   * `width`. A flex column's `width` counts toward the table's minimum width (the horizontal scroll threshold), but it is
   * only guaranteed as a floor when it is the table's single flex column: with several, an equal share can be narrower
   * than one column's `width`. Use one flex column per table.
   */
  flex?: boolean
  /**
   * Overrides whether the user can drag this column's width (tables with a `tableId` only). By default every column is
   * resizable except a `flex` one and `icon` / `switch` columns. `true` forces a handle, `false` removes it. On a flex
   * column the dragged width is only its floor (see `flex`).
   */
  resizable?: boolean
  /** Opt-out: no tooltip with the full text when this column's cells (or its header) are cut off. */
  tooltip?: false
  /** The tooltip's text for a cut-off cell of this row, instead of the cell's rendered text. */
  tooltipText?: (row: T) => string
  /** The cells of this column may wrap onto several lines (the row grows) instead of being cut off with an ellipsis. */
  wrap?: boolean
  headerClassName?: string
  cellClassName?: string
  /** Opt-in: the Columns menu lets the user hide this column. Default false (never hideable). */
  hideable?: boolean
  /** Hideable columns only: shown unless a layout hides it. Default true. */
  defaultVisible?: boolean
  /** Name in the Columns menu; falls back to `header` when that is a string. A hideable column needs one of them. */
  label?: string
  /**
   * Makes the column sortable: the value a row sorts by (cells are React nodes, so it is given explicitly). Strings
   * compare case-insensitively and numeric-aware, numbers numerically, Dates and booleans by their numeric value;
   * null / undefined / NaN sort last in both directions. Rows are sorted by the table only in client-side mode.
   */
  sortValue?: (row: T) => SortValue
}

export interface SelectionColumnConfig {
  /** px; default 32. */
  width?: number
  /** Replaces the select-all checkbox (multi) or the empty header cell (single). */
  header?: ReactNode
}

export type ContextMenuItemDef<T> =
  | {
      key: string
      label: ReactNode
      icon?: ReactNode
      destructive?: boolean
      disabled?: boolean
      /** Receives the rows the menu was opened on (the whole selection when right-clicking a selected row). */
      onSelect: (rows: T[]) => void
    }
  | { key: string; separator: true }
  /** A submenu. Its items receive the same rows as top-level ones; separators, destructive and disabled items work the same. */
  | { key: string; label: ReactNode; icon?: ReactNode; disabled?: boolean; items: ContextMenuItemDef<T>[] }

export interface SearchConfig<T = unknown> {
  /** Seeds the input (default ""); the table keeps its own input state and calls onChange debounced. */
  value?: string
  /** Controlled mode: the page filters on this. Optional in client-side mode (the table filters itself). */
  onChange?: (value: string) => void
  /**
   * Client-side mode: does `row` match? `query` is already trimmed and lowercased and never empty (an empty
   * query means no filter). MUST have a stable identity (module-level function or useCallback), otherwise the
   * filter memo re-runs on every render.
   */
  match?: (row: T, query: string) => boolean
  placeholder?: string
  /** Default 300. */
  debounceMs?: number
}

export interface PaginationConfig {
  /** 1-based. */
  page: number
  pageSize: number
  /** Total rows across all pages (after filtering); the page owns the slicing. */
  total: number
  onPageChange: (page: number) => void
  itemLabel: { singular: string; plural: string }
  /**
   * Count-only footer: no Previous / Next / page buttons, no clamping and no `onPageChange` calls (the page owns a list
   * that is not paged, e.g. pagination switched off). The count, "· N selected", the dock clearance and the loading
   * placeholder stay.
   */
  hidePages?: boolean
}

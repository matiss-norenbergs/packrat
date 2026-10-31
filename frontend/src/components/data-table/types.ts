import type { ReactNode } from "react"

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
  /** Exact column width in px. Any column with a width switches the table to a fixed layout. */
  width?: number
  /** Lower bound in px; also the base width of a width-less column in a fixed layout. */
  minWidth?: number
  /** This column absorbs spare space when the table is wider than the sum of its columns. */
  flex?: boolean
  headerClassName?: string
  cellClassName?: string
  /** Opt-in: the Columns menu lets the user hide this column. Default false (never hideable). */
  hideable?: boolean
  /** Hideable columns only: shown unless a layout hides it. Default true. */
  defaultVisible?: boolean
  /** Name in the Columns menu; falls back to `header` when that is a string. A hideable column needs one of them. */
  label?: string
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
}

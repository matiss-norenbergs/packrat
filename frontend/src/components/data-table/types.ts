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
}

export interface SelectionColumnConfig {
  /** px; default 32. */
  width?: number
  /** Replaces the select-all checkbox (multi) or the empty header cell (single). */
  header?: ReactNode
}

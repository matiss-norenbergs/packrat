import type { ColumnAlign, ColumnDef, ColumnType } from "./types"

const ALIGN_BY_TYPE: Record<ColumnType, ColumnAlign> = {
  text: "left",
  number: "right",
  date: "center",
  status: "center",
  icon: "center",
  switch: "center",
}

export const ALIGN_CLASS: Record<ColumnAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
}

export const JUSTIFY_CLASS: Record<ColumnAlign, string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
}

export const SELECTION_COLUMN_WIDTH = 32
/** Width in px of a column that declares none, by its type. */
export const DEFAULT_WIDTH_BY_TYPE: Record<ColumnType, number> = {
  text: 200,
  number: 110,
  date: 180,
  status: 130,
  icon: 64,
  switch: 96,
}
/** Lower bound in px of any column that declares no `minWidth`. */
export const DEFAULT_MIN_WIDTH = 48

/** Cells and headers never wrap by default: what does not fit is cut off with an ellipsis. */
export const CLIP_CLASS = "overflow-hidden text-ellipsis whitespace-nowrap"
/** A `wrap` column: long words break so nothing overflows the column. */
export const WRAP_CLASS = "whitespace-normal break-words"

export function clipClass<T>(column: ColumnDef<T>): string {
  return column.wrap ? WRAP_CLASS : CLIP_CLASS
}

export function resolveAlign<T>(column: ColumnDef<T>): ColumnAlign {
  return column.align ?? ALIGN_BY_TYPE[column.type ?? "text"]
}

/** The width a column is laid out at: its `width` (else the default for its type), never below its `minWidth`. */
export function columnWidth<T>(column: ColumnDef<T>): number {
  return Math.max(column.width ?? DEFAULT_WIDTH_BY_TYPE[column.type ?? "text"], column.minWidth ?? DEFAULT_MIN_WIDTH)
}

export interface TableLayout {
  /** Per-column width for the colgroup; undefined for a flex column (it absorbs the spare space). Excludes the selection column. */
  colWidths: (number | undefined)[]
  /** Sum of every column's width (+ selection column); the table never shrinks below it. */
  minWidth: number
  /** True when no column is flex: the table then ends in an empty filler column that takes the spare space. */
  filler: boolean
}

// Every table is `table-layout: fixed`: the real columns keep their exact width, and the spare space goes either to
// the flex columns (explicit opt-in; their width is only their minimum) or, when there are none, to the filler column.
export function computeLayout<T>(columns: ColumnDef<T>[], selectionWidth: number | null): TableLayout {
  return {
    colWidths: columns.map((c) => (c.flex ? undefined : columnWidth(c))),
    minWidth: columns.reduce((sum, c) => sum + columnWidth(c), selectionWidth ?? 0),
    filler: !columns.some((c) => c.flex),
  }
}

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
// Base width of a column in a fixed layout that declares neither width nor minWidth.
export const DEFAULT_COLUMN_WIDTH = 120

export function resolveAlign<T>(column: ColumnDef<T>): ColumnAlign {
  return column.align ?? ALIGN_BY_TYPE[column.type ?? "text"]
}

export interface TableLayout {
  /** True when any column declares a width: the table uses table-layout: fixed with a colgroup. */
  fixed: boolean
  /** Per-column width for the colgroup; undefined lets the column absorb spare space. Excludes the selection column. */
  colWidths: (number | undefined)[]
  /** Sum of every column's base width (+ selection column); the table never shrinks below it. */
  minWidth: number | undefined
}

// A fixed-layout column without a width is handed the leftover space by the browser, so the
// absorbing columns (every flex column, else the last one) simply get no colgroup width while
// still counting their base width toward the table's min-width.
export function computeLayout<T>(columns: ColumnDef<T>[], selectionWidth: number | null): TableLayout {
  const fixed = columns.some((c) => c.width != null)
  if (!fixed) return { fixed: false, colWidths: columns.map(() => undefined), minWidth: undefined }

  const hasFlex = columns.some((c) => c.flex)
  const lastIdx = columns.length - 1
  const base = (c: ColumnDef<T>) => c.width ?? c.minWidth ?? DEFAULT_COLUMN_WIDTH
  const absorbs = (c: ColumnDef<T>, i: number) => (hasFlex ? !!c.flex : i === lastIdx)

  return {
    fixed: true,
    colWidths: columns.map((c, i) => (absorbs(c, i) ? undefined : (c.width ?? c.minWidth))),
    minWidth: columns.reduce((sum, c) => sum + base(c), selectionWidth ?? 0),
  }
}

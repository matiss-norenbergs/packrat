import type { TableLayout } from "@/types/api"

export type SortDir = "asc" | "desc"
export interface SortState {
  key: string
  dir: SortDir
}
/** What a column's `sortValue` may return. null / undefined / NaN (and an invalid Date) sort last in both directions. */
export type SortValue = string | number | boolean | Date | null | undefined

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "accent" })

// Dates and booleans become numbers; "no value" becomes null.
function canonical(v: SortValue): string | number | null {
  if (v == null) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime()
  if (typeof v === "boolean") return v ? 1 : 0
  if (typeof v === "number") return Number.isNaN(v) ? null : v
  return v
}

/** Ascending comparison of two canonical values; callers handle null. A string never equals a number. */
function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0
  return collator.compare(String(a), String(b))
}

/**
 * A copy of `rows` ordered by `getValue`. Strings use a case-insensitive, numeric-aware collator ("file2" before
 * "file10"), numbers compare numerically, Dates and booleans by their numeric value. Rows without a value come last
 * whichever the direction, and ties keep the original order.
 */
export function sortRows<T>(rows: readonly T[], getValue: (row: T) => SortValue, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: canonical(getValue(row)) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value === b.value) return a.index - b.index
        return a.value === null ? 1 : -1
      }
      return sign * compareValues(a.value, b.value) || a.index - b.index
    })
    .map((d) => d.row)
}

export function sameSort(a: SortState | undefined, b: SortState | undefined): boolean {
  return a === b || (a != null && b != null && a.key === b.key && a.dir === b.dir)
}

/** The sort the table shows: the working one, else the default, else none. */
export function effectiveSort(working: SortState | undefined, defaultSort: SortState | undefined): SortState | undefined {
  return working ?? defaultSort
}

/** An explicit sort equal to the default is stored as "no sort", so layouts compare and save in one form. */
export function canonicalSort(sort: SortState | undefined, defaultSort: SortState | undefined): SortState | undefined {
  return sort && !sameSort(sort, defaultSort) ? { key: sort.key, dir: sort.dir } : undefined
}

/**
 * The working sort (undefined = the default order) after a click on column `key`.
 * No sort or another column -> asc; asc -> desc; desc -> back to the default order. If going back would not change
 * what is shown (the column's own default is desc) the cycle moves on to asc instead, so it never gets stuck.
 */
export function nextSort(working: SortState | undefined, key: string, defaultSort: SortState | undefined): SortState | undefined {
  const current = effectiveSort(working, defaultSort)
  if (!current || current.key !== key) return canonicalSort({ key, dir: "asc" }, defaultSort)
  if (current.dir === "asc") return canonicalSort({ key, dir: "desc" }, defaultSort)
  if (!sameSort(defaultSort, current)) return undefined
  return canonicalSort({ key, dir: "asc" }, defaultSort)
}

/** `layout` after a click on column `key`; `sort` is dropped from it when the result is the default order. */
export function cycleLayoutSort(layout: TableLayout, key: string, defaultSort: SortState | undefined): TableLayout {
  const { sort: _old, ...rest } = layout
  const next = nextSort(layout.sort, key, defaultSort)
  return next ? { ...rest, sort: next } : rest
}

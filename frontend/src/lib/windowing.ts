import { focusReturnElements } from "@/lib/focusReturn"

/**
 * The count above which a `virtualize` list is windowed (the grid's items, the table's rows); at or below it the list is the
 * plain DOM. One number for `ResponsiveGrid` and `DataTable`. Kept here, not in either component, so reading it never pulls a
 * windowing implementation (and `@tanstack/react-virtual`) into a chunk that does not window.
 */
export const VIRTUALIZE_THRESHOLD = 200

/**
 * The rows a windowed list must keep mounted wherever the user has scrolled, on top of the window itself: the one holding
 * keyboard focus (or focus drops to <body>) and the ones holding an element a closing dialog will give focus back to
 * (`focusReturnElements`). `base` is the virtualizer's own range (`defaultRangeExtractor(range)`); `rowOf` maps an element
 * inside `region` to its row index (-1 when it is in none). Returns the indexes sorted ascending, as a virtualizer expects.
 */
export function withKeptRows(base: readonly number[], count: number, region: HTMLElement | null, rowOf: (el: HTMLElement) => number): number[] {
  const indexes = new Set(base)
  if (region) {
    for (const el of [document.activeElement, ...focusReturnElements()]) {
      if (!el || !region.contains(el)) continue
      const row = rowOf(el as HTMLElement)
      if (row >= 0 && row < count) indexes.add(row)
    }
  }
  return [...indexes].sort((a, b) => a - b)
}

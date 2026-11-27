/** One step of a preset: from `minWidth` px of viewport width up, the grid has `columns` columns. */
export interface ColumnBreakpoint {
  minWidth: number
  columns: number
}

export interface ColumnPreset {
  /**
   * The Tailwind classes of the grid element (`grid`, the column rule and the gap). Written out literally, because
   * Tailwind only emits classes its scanner finds verbatim in the source.
   */
  className: string
  /** The same column rule as numbers, ascending by `minWidth` (Tailwind's `sm` = 640px, `lg` = 1024px; viewport-based). */
  breakpoints: readonly ColumnBreakpoint[]
  /** The gap in px, the same as the `gap-N` in `className`. */
  gap: number
  /** A guess at one row's height in px (without the gap) for the windowed grid, until the row has been measured. */
  estimateRowHeight: number
}

/**
 * The column rules a ResponsiveGrid can use. Each carries the class string (what the browser lays out today) and the
 * breakpoint table (what a JS column-count calculation needs, e.g. the windowed grid); `columns.test.ts` fails when the
 * two stop agreeing.
 */
export const COLUMN_PRESETS = {
  /** The Library grid and the Folders view: 2 / 3 / 4 columns, 16px gap. */
  library: {
    className: "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4",
    breakpoints: [
      { minWidth: 0, columns: 2 },
      { minWidth: 640, columns: 3 },
      { minWidth: 1024, columns: 4 },
    ],
    gap: 16,
    // LibraryCard's `contain-intrinsic-size: auto 280px`.
    estimateRowHeight: 280,
  },
  /** The thumbnail gallery's rule: 2 / 4 / 6 columns, 12px gap (not used by a ResponsiveGrid yet). */
  gallery: {
    className: "grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6",
    breakpoints: [
      { minWidth: 0, columns: 2 },
      { minWidth: 640, columns: 4 },
      { minWidth: 1024, columns: 6 },
    ],
    gap: 12,
    estimateRowHeight: 160,
  },
} as const satisfies Record<string, ColumnPreset>

export type ColumnPresetName = keyof typeof COLUMN_PRESETS

/** The column count at a viewport width, from a preset's breakpoint table (the last step whose `minWidth` fits). */
export function columnsAtWidth(preset: ColumnPreset, width: number): number {
  let columns = preset.breakpoints[0].columns
  for (const step of preset.breakpoints) if (width >= step.minWidth) columns = step.columns
  return columns
}

import { useCallback, useLayoutEffect, useRef } from "react"
import type { ComponentType, ReactElement } from "react"
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import type { Range } from "@tanstack/react-virtual"
import { focusReturnElements } from "@/lib/focusReturn"
import type { ColumnPreset } from "./columns"
import type { GridElementProps } from "./ResponsiveGrid"
import { useColumnCount } from "./useColumnCount"

/** Rows mounted beyond the visible ones, on each side. */
const OVERSCAN_ROWS = 3
/** The scroll region's top padding (`py-1`), i.e. how far the grid starts below the region's scroll origin. */
const REGION_PADDING_TOP = 4

/**
 * Cards skip rendering off screen with `content-visibility: auto` and then report only their `contain-intrinsic-size`
 * (280px), so a row of overscan cards would be measured at the estimate and jump to its real height when it scrolls
 * into view. A windowed grid mounts only what is near the viewport, so the optimization has nothing left to save:
 * switch it off for the cards (the `[data-slot=card]` rule outweighs the card's own single-class utility).
 */
const WINDOWED_CONTAINER_CLASS = "relative w-full [&_[data-slot=card]]:[content-visibility:visible]"

interface WindowedCellsProps {
  /** The memoized cells; rows slice this array, so a cell whose row stays mounted is the same element and does not re-render. */
  cells: readonly ReactElement[]
  preset: ColumnPreset
  /** The scroll region (the element that owns `data-focus-region`). */
  region: HTMLElement | null
  resetKey?: string
  estimateRowHeight?: number
  gridClassName?: string
  gridComponent?: ComponentType<GridElementProps>
}

/**
 * The windowed form of the grid: the cells are chunked into rows of `columns` cells, only the rows near the viewport are
 * mounted, and each row is its own CSS grid (the preset's column rule) positioned absolutely inside a container as tall as
 * all the rows together. A row is as tall as its tallest cell, as in the plain grid. Heights are measured, the preset's
 * estimate stands in until a row has been.
 */
export function WindowedCells({ cells, preset, region, resetKey, estimateRowHeight, gridClassName, gridComponent: GridElement }: WindowedCellsProps) {
  const columns = useColumnCount(preset)
  const count = Math.ceil(cells.length / columns)
  const estimate = estimateRowHeight ?? preset.estimateRowHeight

  // The rows that must stay mounted wherever the user has scrolled: the one holding keyboard focus (or it drops to
  // <body>) and the ones holding an element a closing dialog will give focus back to.
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = new Set(defaultRangeExtractor(range))
      if (region) {
        for (const el of [document.activeElement, ...focusReturnElements()]) {
          if (!el || !region.contains(el)) continue
          const first = el.closest<HTMLElement>("[data-first-item]")?.dataset.firstItem
          const row = first == null ? -1 : Math.floor(Number(first) / columns)
          if (row >= 0 && row < range.count) indexes.add(row)
        }
      }
      return [...indexes].sort((a, b) => a - b)
    },
    [region, columns],
  )

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => region,
    estimateSize: () => estimate,
    gap: preset.gap,
    overscan: OVERSCAN_ROWS,
    scrollMargin: REGION_PADDING_TOP,
    // A row is keyed by its first cell, so a refetch with the same items keeps every measurement and every mounted row.
    getItemKey: (index) => cells[index * columns]?.key ?? index,
    rangeExtractor,
    initialRect: { width: 1024, height: 800 },
  })

  const virtualRows = virtualizer.getVirtualItems()

  // Keep the first visible item where it is when the column count changes (a breakpoint was crossed): its row index is
  // not the same any more, and the old pixel offset would land somewhere else. `anchor` is only updated while the count
  // is unchanged, so on the render that sees the new count it still holds the item from the old layout.
  const anchor = useRef({ columns, firstItem: 0 })
  if (anchor.current.columns === columns) anchor.current.firstItem = (virtualizer.range?.startIndex ?? 0) * columns
  useLayoutEffect(() => {
    if (anchor.current.columns === columns) return
    anchor.current.columns = columns
    virtualizer.scrollToIndex(Math.floor(anchor.current.firstItem / columns), { align: "start" })
  }, [columns, virtualizer])

  // The parent's `useScrollTopOnChange` moves the region to the top; this tells the virtualizer in the same commit, so it
  // does not render the old window first.
  const lastResetKey = useRef(resetKey)
  useLayoutEffect(() => {
    if (lastResetKey.current === resetKey) return
    lastResetKey.current = resetKey
    virtualizer.scrollToOffset(0)
  }, [resetKey, virtualizer])

  const rows = virtualRows.map((row) => {
    const first = row.index * columns
    return (
      <div
        key={row.key}
        ref={virtualizer.measureElement}
        data-index={row.index}
        data-first-item={first}
        className={preset.className}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start - REGION_PADDING_TOP}px)` }}
      >
        {cells.slice(first, first + columns)}
      </div>
    )
  })

  const className = gridClassName ? `${WINDOWED_CONTAINER_CLASS} ${gridClassName}` : WINDOWED_CONTAINER_CLASS
  const style = { height: virtualizer.getTotalSize() }
  return GridElement ? (
    <GridElement className={className} style={style} windowed>
      {rows}
    </GridElement>
  ) : (
    <div className={className} style={style}>
      {rows}
    </div>
  )
}

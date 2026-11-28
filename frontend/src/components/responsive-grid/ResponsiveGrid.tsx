import { Fragment, useCallback, useMemo, useRef, useState } from "react"
import type { ComponentType, CSSProperties, ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { useScrollTopOnChange } from "@/hooks/useScrollTopOnChange"
import { VIRTUALIZE_THRESHOLD } from "@/lib/windowing"
import { COLUMN_PRESETS } from "./columns"
import type { ColumnPresetName } from "./columns"
import { WindowedCells } from "./WindowedCells"

/** The item count above which a `virtualize` grid is windowed; at or below it the grid is the plain DOM grid. Shared with DataTable. */
export { VIRTUALIZE_THRESHOLD }

/**
 * What a custom grid element (`gridComponent`) receives: the classes to put on its element and the built cells.
 * Plain mode: `className` is the preset's column rule plus `gridClassName`, `children` the cells. Windowed mode
 * (`windowed`): `className` is only the positioning (`relative`) plus `gridClassName`, no column rule, because each row
 * carries it; `style` holds the total height; `children` are the mounted rows. Either way put them on one element and pass
 * `children` through untouched.
 */
export interface GridElementProps {
  className: string
  children: ReactNode
  style?: CSSProperties
  windowed?: boolean
}

export interface ResponsiveGridProps<T> {
  items: readonly T[]
  /** A stable key per cell. Cells of different kinds share one list, so keys must be unique across all of it. */
  getKey: (item: T, index: number) => string | number
  /** Builds one cell; the item type may be a union and this decides what each one renders. Keep it stable (useCallback). */
  renderItem: (item: T, index: number) => ReactNode
  /** The column rule (see `columns.ts`). */
  columns: ColumnPresetName
  /** The region returns to the top when this changes (a new page, filter, sort or folder); not on mount. */
  resetKey?: string
  /** Shown (instead of everything below) while true. Precedence: loading, error, empty, items. */
  loading?: boolean
  /** How many placeholders `loading` shows with the default `renderSkeleton`. */
  skeletonCount?: number
  /** One loading placeholder cell; the default is a 16:9 `Skeleton`. */
  renderSkeleton?: (index: number) => ReactNode
  /** Shown in the region when set (and not loading), e.g. an error line. */
  error?: ReactNode
  /** Shown in the region when set (and not loading, no error), e.g. "nothing here yet". Setting it means "show it". */
  empty?: ReactNode
  /**
   * Opt in to windowing: with more than `virtualizeThreshold` items only the rows near the viewport are in the DOM (see
   * docs/architecture.md, "ResponsiveGrid"). A page's choice, never a user setting. Off, or at or below the threshold, the
   * grid is the plain one.
   */
  virtualize?: boolean
  /** Items above which `virtualize` takes effect. Default `VIRTUALIZE_THRESHOLD`. */
  virtualizeThreshold?: number
  /** A guess at a row's height in px (without the gap) for rows not yet measured. Default: the preset's. */
  estimateRowHeight?: number
  /** Appended to the preset's classes on the grid element (the Library adds `group/lib-grid`). */
  gridClassName?: string
  /**
   * Renders the grid element instead of a plain `div`, for things like `data-selecting` that depend on state the cells must
   * not re-render for. It gets the finished cells (or, windowed, the rows of them) as `children` and must pass them through
   * untouched; then a state change inside it re-renders the wrapper and none of the cells. Loading placeholders use a plain `div`.
   */
  gridComponent?: ComponentType<GridElementProps>
  /** `data-testid` of the scroll region. */
  scrollTestId?: string
  /** Appended to the scroll region's classes. */
  className?: string
}

const SCROLL_REGION_CLASS =
  "-my-1 -ml-1 -mr-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1 pl-1 pr-2 [scrollbar-gutter:stable]"

function DefaultSkeleton() {
  return <Skeleton className="aspect-video w-full" />
}

/**
 * A grid of cells that owns its scroll region and fills its parent (`min-h-0 flex-1`, so the parent is a flex column with a
 * height). It knows nothing about what a cell is: callers pass `items`, `getKey` and `renderItem`, plus the loading, error
 * and empty states, of which exactly one of loading / error / empty / items is shown, all inside the one scroll region.
 * It renders no header or footer; those are fixed siblings the caller puts around it.
 *
 * The region is borderless. `-mr-2 pr-2` moves the scrollbar 8px away from the cells, the stable gutter keeps the column
 * widths the same on pages with and without a scrollbar, and the 4px padding all around (cancelled by the negative margins)
 * leaves room for a cell's focus ring and hover shadow, which overflow hidden would otherwise clip.
 *
 * Every cell is rendered unless the page opted in with `virtualize` and has more than the threshold of items; then only the
 * rows near the viewport are (see docs/architecture.md, "ResponsiveGrid").
 */
export function ResponsiveGrid<T>({
  items,
  getKey,
  renderItem,
  columns,
  resetKey,
  loading = false,
  skeletonCount = 3,
  renderSkeleton,
  error,
  empty,
  virtualize = false,
  virtualizeThreshold = VIRTUALIZE_THRESHOLD,
  estimateRowHeight,
  gridClassName,
  gridComponent: GridElement,
  scrollTestId,
  className,
}: ResponsiveGridProps<T>) {
  const regionRef = useRef<HTMLDivElement | null>(null)
  const windowed = virtualize && items.length > virtualizeThreshold
  // The windowed grid needs the region element itself (its scroll element) as soon as it exists. State is set only then, so a
  // plain grid never renders an extra time for it.
  const [region, setRegion] = useState<HTMLDivElement | null>(null)
  const attachRegion = useCallback(
    (el: HTMLDivElement | null) => {
      regionRef.current = el
      if (windowed) setRegion(el)
    },
    [windowed],
  )
  useScrollTopOnChange(() => regionRef.current, [resetKey])

  const gridClass = gridClassName ? `${COLUMN_PRESETS[columns].className} ${gridClassName}` : COLUMN_PRESETS[columns].className

  // A keyed Fragment adds no DOM, so `renderItem` may return any node without a key. Rebuilt only when the items or the callbacks change, so a re-render for any other reason (a URL change that leaves the
  // items alone) hands React the same elements and no cell re-renders.
  const cells = useMemo(
    () => items.map((item, index) => <Fragment key={getKey(item, index)}>{renderItem(item, index)}</Fragment>),
    [items, getKey, renderItem],
  )

  let content: ReactNode
  if (loading) {
    content = (
      <div className={COLUMN_PRESETS[columns].className}>
        {Array.from({ length: skeletonCount }, (_, i) => (renderSkeleton ? <Fragment key={i}>{renderSkeleton(i)}</Fragment> : <DefaultSkeleton key={i} />))}
      </div>
    )
  } else if (error) {
    content = error
  } else if (empty) {
    content = empty
  } else if (windowed) {
    content = (
      <WindowedCells
        cells={cells}
        preset={COLUMN_PRESETS[columns]}
        region={region}
        resetKey={resetKey}
        estimateRowHeight={estimateRowHeight}
        gridClassName={gridClassName}
        gridComponent={GridElement}
      />
    )
  } else if (GridElement) {
    content = <GridElement className={gridClass}>{cells}</GridElement>
  } else {
    content = <div className={gridClass}>{cells}</div>
  }

  return (
    <div
      ref={attachRegion}
      data-testid={scrollTestId}
      data-focus-region
      className={className ? `${SCROLL_REGION_CLASS} ${className}` : SCROLL_REGION_CLASS}
    >
      {content}
    </div>
  )
}

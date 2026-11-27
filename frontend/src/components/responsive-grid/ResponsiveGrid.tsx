import { Fragment, useMemo, useRef } from "react"
import type { ComponentType, ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { useScrollTopOnChange } from "@/hooks/useScrollTopOnChange"
import { COLUMN_PRESETS } from "./columns"
import type { ColumnPresetName } from "./columns"

/** What a custom grid element (`gridComponent`) receives: the classes to put on its element and the built cells. */
export interface GridElementProps {
  className: string
  children: ReactNode
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
  /** Appended to the preset's classes on the grid element (the Library adds `group/lib-grid`). */
  gridClassName?: string
  /**
   * Renders the grid element instead of a plain `div`, for things like `data-selecting` that depend on state the cells must
   * not re-render for. It gets the finished cells as `children` and must pass them through untouched; then a state change
   * inside it re-renders the wrapper and none of the cells. Loading placeholders use a plain `div`.
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
 * Every cell is rendered; there is no windowing here (see docs/architecture.md, "ResponsiveGrid").
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
  gridClassName,
  gridComponent: GridElement,
  scrollTestId,
  className,
}: ResponsiveGridProps<T>) {
  const regionRef = useRef<HTMLDivElement>(null)
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
  } else if (GridElement) {
    content = <GridElement className={gridClass}>{cells}</GridElement>
  } else {
    content = <div className={gridClass}>{cells}</div>
  }

  return (
    <div
      ref={regionRef}
      data-testid={scrollTestId}
      data-focus-region
      className={className ? `${SCROLL_REGION_CLASS} ${className}` : SCROLL_REGION_CLASS}
    >
      {content}
    </div>
  )
}

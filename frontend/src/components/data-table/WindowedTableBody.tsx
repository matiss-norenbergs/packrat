import { useCallback, useLayoutEffect, useRef, useState } from "react"
import type { HTMLAttributes, ReactNode } from "react"
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import type { Range } from "@tanstack/react-virtual"
import { TableBody } from "@/components/ui/table"
import { withKeptRows } from "@/lib/windowing"

/** Rows mounted beyond the visible ones, on each side. */
const OVERSCAN_ROWS = 8
/** The sticky header's height until it is measured (`TableHead` is `h-10`). */
const DEFAULT_HEADER_HEIGHT = 40
/** A row's height until one has been measured: a 16:9 thumbnail 56px wide (31.5px) in `p-2` cells, plus the row border. */
export const DEFAULT_ESTIMATE_ROW_HEIGHT = 48.5

/** What the windowed body needs from the table; the table keeps everything that knows about rows and columns. */
export interface WindowedTableBodyProps {
  /** All rows, not only the mounted ones. */
  count: number
  /** A stable key per row (its id), so measurements and mounted rows survive a refetch with unchanged items. */
  getKey: (index: number) => string
  /** One row; `measureRef` goes on its `<tr>` together with `data-index`. */
  renderRow: (index: number, measureRef: (el: Element | null) => void) => ReactNode
  /** Cells per row including the selection column and the filler, so a spacer spans the table. */
  columnSpan: number
  /** The delegated handlers of the tbody (overflow tooltips). */
  bodyProps?: HTMLAttributes<HTMLTableSectionElement>
  /** When any value changes the scroll position goes back to the top in the same commit (a new page, sort or search). */
  scrollKey: readonly unknown[]
  /** Changes when the column widths do (a resize, a hidden column, a restored layout): row heights may follow, so all are measured again. */
  measureKey: string
  /** A guess at a row's height in px for rows not yet measured. */
  estimateRowHeight?: number
}

const spacerStyle = (height: number) => ({ height, padding: 0, border: 0 })

function Spacer({ height, columnSpan }: { height: number; columnSpan: number }) {
  // A plain <tr> (not TableRow: no border, no hover). aria-hidden keeps it out of the table's rows for assistive technology.
  return (
    <tr aria-hidden="true" data-windowed-spacer style={{ height }}>
      <td colSpan={columnSpan} style={spacerStyle(height)} />
    </tr>
  )
}

/**
 * The windowed `<tbody>` of a DataTable: only the rows near the viewport are mounted, between a top and a bottom spacer row whose
 * heights stand in for the rows that are not, so the scroll height, the sticky header and the column widths are the plain
 * table's. (A row kept mounted far from the window, see `withKeptRows`, gets a spacer of its own before it.) Row heights are
 * measured; the mean of the measured ones stands in for the others. Loaded on demand (DataTable `lazy`s it) so the tables that
 * never window do not carry `@tanstack/react-virtual`.
 */
export default function WindowedTableBody({ count, getKey, renderRow, columnSpan, bodyProps, scrollKey, measureKey, estimateRowHeight = DEFAULT_ESTIMATE_ROW_HEIGHT }: WindowedTableBodyProps) {
  // The table's one scroll container (the element focusReturn also falls back to), found from the tbody once it exists.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  const attach = useCallback((el: HTMLTableSectionElement | null) => {
    setScrollEl(el?.closest<HTMLElement>('[data-slot="table-container"]') ?? null)
  }, [])

  // The sticky header sits above the first row inside the scroll container, so rows start that far down.
  const [headerHeight, setHeaderHeight] = useState(DEFAULT_HEADER_HEIGHT)
  useLayoutEffect(() => {
    // Fractional (the collapsed border makes it 40.5px): offsetHeight rounds, and the first row would sit a fraction of a pixel off.
    const h = scrollEl?.querySelector("thead")?.getBoundingClientRect().height
    if (h && h !== headerHeight) setHeaderHeight(h)
  }, [scrollEl, headerHeight])

  const rangeExtractor = useCallback(
    (range: Range) =>
      withKeptRows(defaultRangeExtractor(range), range.count, scrollEl, (el) => {
        const index = el.closest<HTMLElement>("tr[data-index]")?.dataset.index
        return index == null ? -1 : Number(index)
      }),
    [scrollEl],
  )

  // The mean of the measured rows stands in for the rows not measured yet, which keeps the total height (the scrollbar) from
  // drifting as the user scrolls into new rows.
  const measured = useRef({ heights: new Map<string, number>(), sum: 0 })
  const measureRow = useCallback((el: Element, entry: ResizeObserverEntry | undefined) => {
    // Not rounded (the library's default does): rows are 48.5px with the collapsed border, and over thousands of rows half a pixel each is a scrollbar that ends far from the plain table's.
    const height = entry?.borderBoxSize?.[0]?.blockSize ?? el.getBoundingClientRect().height
    const m = measured.current
    const key = (el as HTMLElement).dataset.rowId ?? ""
    m.sum += height - (m.heights.get(key) ?? 0)
    m.heights.set(key, height)
    return height
  }, [])

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollEl,
    estimateSize: () => (measured.current.heights.size > 0 ? measured.current.sum / measured.current.heights.size : estimateRowHeight),
    measureElement: measureRow,
    overscan: OVERSCAN_ROWS,
    scrollMargin: headerHeight,
    getItemKey: getKey,
    rangeExtractor,
    initialRect: { width: 1024, height: 800 },
  })

  // A column width changed (a drag, a hidden column, a saved layout): cell content wraps differently, so every height may be
  // new. Forget the measurements and measure the mounted rows now (a row whose size did not change would not report again).
  const lastMeasureKey = useRef(measureKey)
  useLayoutEffect(() => {
    if (lastMeasureKey.current === measureKey) return
    lastMeasureKey.current = measureKey
    measured.current = { heights: new Map(), sum: 0 }
    virtualizer.measure()
    // resizeItem, not measureElement: that one skips the measurement while a scroll is in progress.
    scrollEl?.querySelectorAll<HTMLElement>("tr[data-index]").forEach((row) => virtualizer.resizeItem(Number(row.dataset.index), measureRow(row, undefined)))
  }, [measureKey, virtualizer, scrollEl, measureRow])

  // The table's `useScrollTopOnChange` moves the container to the top; this tells the virtualizer in the same commit, so it does
  // not render the old window first.
  const lastScrollKey = useRef(scrollKey)
  useLayoutEffect(() => {
    const prev = lastScrollKey.current
    lastScrollKey.current = scrollKey
    if (scrollKey.every((v, i) => Object.is(v, prev[i]))) return
    virtualizer.scrollToOffset(0)
  }, [scrollKey, virtualizer])

  const items = virtualizer.getVirtualItems()
  const total = virtualizer.getTotalSize()
  // `end` is where the previous row stopped, from the first row's top (the margin is the header). A kept row far from the window
  // leaves a gap, which gets a spacer of its own.
  const out: ReactNode[] = []
  let end = 0
  for (const item of items) {
    const start = item.start - headerHeight
    if (out.length === 0 || start - end >= 1) out.push(<Spacer key={out.length === 0 ? "top" : `gap-${item.key}`} height={Math.max(0, start - end)} columnSpan={columnSpan} />)
    out.push(renderRow(item.index, virtualizer.measureElement))
    end = item.end - headerHeight
  }
  if (out.length === 0) out.push(<Spacer key="top" height={0} columnSpan={columnSpan} />)
  out.push(<Spacer key="bottom" height={Math.max(0, total - end)} columnSpan={columnSpan} />)

  return (
    <TableBody ref={attach} {...bodyProps}>
      {out}
    </TableBody>
  )
}

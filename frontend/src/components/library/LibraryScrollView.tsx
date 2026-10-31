import { useRef } from "react"
import type { ReactNode } from "react"
import { useScrollTopOnChange } from "@/hooks/useScrollTopOnChange"

interface LibraryScrollViewProps {
  /** Fixed above the scroll region (the Folders view's breadcrumb). */
  header?: ReactNode
  /** Fixed below the scroll region (the pagination footer); omitted when pagination is off. */
  footer?: ReactNode
  /** The cards: loading skeletons, error, empty state or the card grid. */
  children: ReactNode
  /** The region returns to the top when this changes (a new page, filter, search, sort or folder); not on mount. */
  resetKey?: string
}

/**
 * The shell of the grid and Folders views: a flex column that owns the height <main> gives it (the Library page is
 * `h-full min-h-0 flex-col`), so only the cards region scrolls while the header and the footer stay in view, like the list
 * view's table. 16px between the parts, like the list.
 *
 * The region is borderless. `-mr-2 pr-2` moves the scrollbar 8px away from the cards, the stable gutter keeps the column
 * widths the same on pages with and without a scrollbar, and the 4px padding all around (cancelled by the negative margins)
 * leaves room for the cards' focus ring and hover shadow, which overflow hidden would otherwise clip.
 */
export function LibraryScrollView({ header, footer, children, resetKey }: LibraryScrollViewProps) {
  const regionRef = useRef<HTMLDivElement>(null)
  useScrollTopOnChange(() => regionRef.current, [resetKey])
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {header}
      <div ref={regionRef} data-testid="library-scroll" className="-my-1 -ml-1 -mr-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1 pl-1 pr-2 [scrollbar-gutter:stable]">
        {children}
      </div>
      {footer}
    </div>
  )
}

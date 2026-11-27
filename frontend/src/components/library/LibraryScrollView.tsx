import type { ReactNode } from "react"

interface LibraryScrollViewProps {
  /** Fixed above the scroll region (the Folders view's breadcrumb). */
  header?: ReactNode
  /** Fixed below the scroll region (the pagination footer); omitted when pagination is off. */
  footer?: ReactNode
  /** The ResponsiveGrid: it is the one scroll region, and it fills what is left between the header and the footer. */
  children: ReactNode
}

/**
 * The shell of the grid and Folders views: a flex column that owns the height <main> gives it (the Library page is
 * `h-full min-h-0 flex-col`), so only the cards region scrolls while the header and the footer stay in view, like the list
 * view's table. 16px between the parts, like the list. The scroll region itself (and its padding, scrollbar gutter and
 * reset to the top) belongs to the ResponsiveGrid inside.
 */
export function LibraryScrollView({ header, footer, children }: LibraryScrollViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {header}
      {children}
      {footer}
    </div>
  )
}

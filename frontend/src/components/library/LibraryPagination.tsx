import { TablePagination } from "@/components/data-table/TablePagination"

interface LibraryPaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  /** The page is still loading: placeholder count, only the current page button, nothing clickable. */
  loading?: boolean
}

// The Library's footer is the shared table footer (count left, numbered pager right, dock-aware). The views render it
// only when pagination is enabled, and then even for a single page. No `selectedCount`: the toolbar shows the selection.
// It sits below the scroll region (LibraryScrollView), outside the area that scrolls, so it is always in view; the 16px
// above it come from the view's gap. While the page loads the views keep it mounted with `loading`, so the scroll
// region's height does not jump when the data arrives.
export function LibraryPagination({ page, pageSize, total, onPageChange, loading }: LibraryPaginationProps) {
  return (
    <TablePagination
      page={page}
      pageSize={pageSize}
      total={total}
      onPageChange={onPageChange}
      loading={loading}
      itemLabel={{ singular: "item", plural: "items" }}
    />
  )
}

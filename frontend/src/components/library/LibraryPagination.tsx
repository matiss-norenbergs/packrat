import { TablePagination } from "@/components/data-table/TablePagination"

interface LibraryPaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

// The Library's footer is the shared table footer (count left, numbered pager right, dock-aware). The views render it
// only when pagination is enabled, and then even for a single page. No `selectedCount`: the toolbar shows the selection.
// The Library page scrolls as a whole, so the footer sits below the content with the old control's extra `pt-2`.
export function LibraryPagination({ page, pageSize, total, onPageChange }: LibraryPaginationProps) {
  return (
    <div className="pt-2">
      <TablePagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={onPageChange}
        itemLabel={{ singular: "item", plural: "items" }}
      />
    </div>
  )
}

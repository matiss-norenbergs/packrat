import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { getPageNumbers } from "@/lib/pagination"
import { DOCK_FOOTER_LABEL, DOCK_FOOTER_ROW } from "@/lib/dockClearance"
import { cn } from "@/lib/utils"
import type { PaginationConfig } from "./types"

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  itemLabel,
  selectedCount = 0,
}: PaginationConfig & { /** Selected rows on the current page; shown after the count when > 0. */ selectedCount?: number }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // The data can shrink under the current page (e.g. deleting the only row on the last
  // page); snap back to the last valid page instead of showing an empty "page 2 of 1".
  useEffect(() => {
    if (page > totalPages) onPageChange(totalPages)
  }, [page, totalPages, onPageChange])

  return (
    <div className={cn("flex shrink-0 items-center justify-between", DOCK_FOOTER_ROW)}>
      <span className={cn("text-sm text-muted-foreground", DOCK_FOOTER_LABEL)}>
        {total} {total === 1 ? itemLabel.singular : itemLabel.plural}
        {selectedCount > 0 && ` · ${selectedCount} selected`}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        {getPageNumbers(page, totalPages).map((p, i) =>
          p === "ellipsis" ? (
            <span key={`ellipsis-${i}`} className="px-1.5 text-sm text-muted-foreground">
              …
            </span>
          ) : (
            <Button
              key={p}
              variant={p === page ? "default" : "outline"}
              size="sm"
              className="w-8 px-0"
              aria-current={p === page ? "page" : undefined}
              onClick={() => onPageChange(p)}
            >
              {p}
            </Button>
          ),
        )}
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}

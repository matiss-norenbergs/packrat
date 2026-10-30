import { Button } from "@/components/ui/button"
import { getPageNumbers } from "@/lib/pagination"
import type { PaginationConfig } from "./types"

export function TablePagination({ page, pageSize, total, onPageChange, itemLabel }: PaginationConfig) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex shrink-0 items-center justify-between">
      <span className="text-sm text-muted-foreground">
        {total} {total === 1 ? itemLabel.singular : itemLabel.plural}
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

import type { ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { ALIGN_CLASS, JUSTIFY_CLASS, computeLayout, resolveAlign } from "./columns"
import type { ColumnDef, RowId } from "./types"

export interface DataTableProps<T, Id extends RowId = number> {
  /** The CURRENT page's rows — filtering and slicing stay in the page. */
  rows: T[]
  getRowId: (row: T) => Id
  columns: ColumnDef<T>[]
  loading?: boolean
  /** Number of skeleton bars shown while loading. */
  loadingRows?: number
  /** Replaces the table (e.g. a load failure message). */
  error?: ReactNode
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode
  rowClassName?: (row: T) => string | undefined
  className?: string
  /** Replaces the scroll container's classes entirely (see Table in components/ui/table.tsx). */
  containerClassName?: string
}

const CONTAINER_CLASS = "h-full overflow-auto rounded-md border"

export function DataTable<T, Id extends RowId = number>({
  rows,
  getRowId,
  columns,
  loading,
  loadingRows = 2,
  error,
  empty,
  rowClassName,
  className,
  containerClassName,
}: DataTableProps<T, Id>) {
  const layout = computeLayout(columns, null)

  let content: ReactNode
  if (loading) {
    content = (
      <div className="space-y-2">
        {Array.from({ length: loadingRows }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  } else if (error) {
    content = error
  } else if (rows.length === 0) {
    content = empty ?? null
  } else {
    content = (
      <Table
        containerClassName={containerClassName ?? CONTAINER_CLASS}
        className={layout.fixed ? "table-fixed" : undefined}
        style={layout.minWidth != null ? { minWidth: layout.minWidth } : undefined}
      >
        {layout.fixed && (
          <colgroup>
            {columns.map((c, i) => (
              <col key={c.key} style={layout.colWidths[i] != null ? { width: layout.colWidths[i] } : undefined} />
            ))}
          </colgroup>
        )}
        <TableHeader>
          <TableRow>
            {columns.map((c) => {
              const align = resolveAlign(c)
              return (
                <TableHead
                  key={c.key}
                  className={cn(ALIGN_CLASS[align], c.headerClassName)}
                  style={c.minWidth != null ? { minWidth: c.minWidth } : undefined}
                >
                  {c.header}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const id = getRowId(row)
            return (
              <TableRow key={String(id)} data-row-id={String(id)} className={rowClassName?.(row)}>
                {columns.map((c) => {
                  const align = resolveAlign(c)
                  // Bare SVGs are display:block under preflight, so text-center can't centre
                  // them; icon cells get a flex wrapper instead of every page needing mx-auto.
                  const cell = c.cell(row)
                  return (
                    <TableCell key={c.key} className={cn(ALIGN_CLASS[align], c.cellClassName)}>
                      {c.type === "icon" ? <div className={cn("flex items-center", JUSTIFY_CLASS[align])}>{cell}</div> : cell}
                    </TableCell>
                  )
                })}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-6", className)}>
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  )
}

import type { ReactNode } from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useIdSelection } from "@/hooks/useIdSelection"
import type { IdSelection } from "@/hooks/useIdSelection"
import { cn } from "@/lib/utils"
import { ALIGN_CLASS, JUSTIFY_CLASS, SELECTION_COLUMN_WIDTH, computeLayout, resolveAlign } from "./columns"
import type { ColumnDef, RowId, SelectionColumnConfig } from "./types"
import { useTableSelection } from "./useTableSelection"
import type { SelectionMode } from "./useTableSelection"

export interface DataTableProps<T, Id extends RowId = number> {
  /** The CURRENT page's rows — filtering and slicing stay in the page. */
  rows: T[]
  getRowId: (row: T) => Id
  columns: ColumnDef<T>[]
  /** Default "none". The checkbox / radio column is generated, not part of `columns`. */
  selection?: SelectionMode
  /** Controlled selection state (useIdSelection) so the page's toolbar can read it; the table keeps its own when omitted. */
  selectionState?: IdSelection<Id>
  selectionColumn?: SelectionColumnConfig
  /** Accessible name of a row's checkbox / radio; defaults to "Select row <id>". */
  getRowLabel?: (row: T) => string
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
  selection: mode = "none",
  selectionState,
  selectionColumn,
  getRowLabel,
  loading,
  loadingRows = 2,
  error,
  empty,
  rowClassName,
  className,
  containerClassName,
}: DataTableProps<T, Id>) {
  const ownSelection = useIdSelection<Id>()
  const selection = selectionState ?? ownSelection
  const { onRowMouseDown, onRowMouseEnter } = useTableSelection({ rows, getRowId, mode, selection })

  const selectable = mode !== "none"
  const selectionWidth = selectionColumn?.width ?? SELECTION_COLUMN_WIDTH
  const layout = computeLayout(columns, selectable ? selectionWidth : null)

  const pageIds = rows.map(getRowId)
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selection.selected.has(id))
  const someSelected = pageIds.some((id) => selection.selected.has(id)) && !allSelected

  const rowLabel = (row: T, id: Id) => (getRowLabel ? getRowLabel(row) : `Select row ${String(id)}`)

  const selectionHeader =
    selectionColumn?.header ??
    (mode === "multi" ? (
      <Checkbox
        checked={allSelected ? true : someSelected ? "indeterminate" : false}
        onCheckedChange={(checked) => (checked ? selection.selectAll(pageIds) : selection.clear())}
        aria-label="Select all"
      />
    ) : null)

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
            {selectable && <col style={{ width: selectionWidth }} />}
            {columns.map((c, i) => (
              <col key={c.key} style={layout.colWidths[i] != null ? { width: layout.colWidths[i] } : undefined} />
            ))}
          </colgroup>
        )}
        <TableHeader>
          <TableRow>
            {selectable && <TableHead className="w-8 text-center">{selectionHeader}</TableHead>}
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
            const selected = selection.isSelected(id)
            return (
              <TableRow
                key={String(id)}
                data-row-id={String(id)}
                data-state={selected ? "selected" : undefined}
                aria-selected={selectable ? selected : undefined}
                className={cn(selectable && "cursor-default select-none", rowClassName?.(row))}
                onMouseDown={selectable ? (e) => onRowMouseDown(e, id) : undefined}
                onMouseEnter={selectable ? () => onRowMouseEnter(id) : undefined}
              >
                {selectable && (
                  <TableCell className={cn("text-center", mode === "single" && "pr-0")}>
                    {mode === "multi" ? (
                      <Checkbox checked={selected} onCheckedChange={() => selection.toggle(id)} aria-label={rowLabel(row, id)} />
                    ) : (
                      <RadioGroupItem value={String(id)} aria-label={rowLabel(row, id)} />
                    )}
                  </TableCell>
                )}
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

  const region = <div className="min-h-0 flex-1">{content}</div>
  const selectedId = mode === "single" ? pageIds.find((id) => selection.selected.has(id)) : undefined

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-6", className)}>
      {mode === "single" ? (
        // Radio-group semantics wrap the region (not the <table>, which would lose its table role).
        <RadioGroupPrimitive.Root
          asChild
          value={selectedId != null ? String(selectedId) : ""}
          onValueChange={(v) => {
            const id = pageIds.find((pid) => String(pid) === v)
            if (id != null) selection.selectOnly(id)
          }}
        >
          {region}
        </RadioGroupPrimitive.Root>
      ) : (
        region
      )}
    </div>
  )
}

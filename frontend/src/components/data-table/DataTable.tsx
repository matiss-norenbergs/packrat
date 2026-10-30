import { useState } from "react"
import type { MouseEvent, ReactNode } from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { Checkbox } from "@/components/ui/checkbox"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useIdSelection } from "@/hooks/useIdSelection"
import type { IdSelection } from "@/hooks/useIdSelection"
import { cn } from "@/lib/utils"
import { TablePagination } from "./TablePagination"
import { TableSearch } from "./TableSearch"
import { ALIGN_CLASS, JUSTIFY_CLASS, SELECTION_COLUMN_WIDTH, computeLayout, resolveAlign } from "./columns"
import type { ColumnDef, ContextMenuItemDef, PaginationConfig, RowId, SearchConfig, SelectionColumnConfig } from "./types"
import { useTableSelection } from "./useTableSelection"
import type { SelectionMode } from "./useTableSelection"

export interface SlotContext<T, Id extends RowId> {
  selection: IdSelection<Id>
  /** The selected rows that are on the current page. */
  selectedRows: T[]
}
export type Slot<T, Id extends RowId> = ReactNode | ((ctx: SlotContext<T, Id>) => ReactNode)

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
  /** Left side of the toolbar (primary action first); a node or a function of the selection for bulk actions. */
  toolbar?: Slot<T, Id>
  /** Right side of the toolbar, rendered before the search box. */
  filters?: Slot<T, Id>
  search?: SearchConfig
  pagination?: PaginationConfig
  /** Right-click menu, built from the rows it applies to. Right-clicking the header or an empty area opens nothing. */
  contextMenu?: (rows: T[]) => ContextMenuItemDef<T>[]
  onRowClick?: (row: T, e: MouseEvent<HTMLTableRowElement>) => void
  onRowDoubleClick?: (row: T, e: MouseEvent<HTMLTableRowElement>) => void
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
  toolbar,
  filters,
  search,
  pagination,
  contextMenu,
  onRowClick,
  onRowDoubleClick,
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

  // Radix's ContextMenu only computes the floating menu's position when its content
  // actually (re)mounts — while it's already open, Presence treats a same-tick open→open
  // toggle as "still mounted" and skips remeasuring, so right-clicking a second row would
  // otherwise leave the menu stuck at the first row's position. Keying ContextMenuContent
  // on this counter forces a genuine remount (and fresh position read) on every
  // right-click, regardless of whether the menu was already open.
  const [contextMenuAnchorKey, setContextMenuAnchorKey] = useState(0)
  const [contextIds, setContextIds] = useState<Id[]>([])

  // Right-clicking a row outside the current selection replaces the selection with just
  // that row (mirroring left-click); right-clicking a selected row leaves a multi-selection
  // intact so the menu acts on the whole group. Without selection the menu acts on the
  // clicked row only. The header / empty area isn't a row action, so it shouldn't open a
  // menu at all — preventDefault skips Radix's own reopen handler too (composeEventHandlers
  // checks event.defaultPrevented), the same escape hatch it uses for the native menu.
  const handleTableContextMenu = (e: MouseEvent) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>("tr[data-row-id]")
    const id = rowEl ? pageIds.find((pid) => String(pid) === rowEl.dataset.rowId) : undefined
    if (id === undefined) {
      e.preventDefault()
      return
    }
    if (!selectable) {
      setContextIds([id])
    } else if (selection.isSelected(id)) {
      setContextIds(pageIds.filter((pid) => selection.isSelected(pid)))
    } else {
      selection.selectOnly(id)
      setContextIds([id])
    }
    setContextMenuAnchorKey((k) => k + 1)
  }

  const selectedRows = rows.filter((r) => selection.isSelected(getRowId(r)))
  const slotCtx = { selection, selectedRows }
  const renderSlot = (slot: Slot<T, Id>) => (typeof slot === "function" ? slot(slotCtx) : slot)

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
    const table = (
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
                className={cn(selectable ? "cursor-default select-none" : onRowClick && "cursor-pointer", rowClassName?.(row))}
                onMouseDown={selectable ? (e) => onRowMouseDown(e, id) : undefined}
                onMouseEnter={selectable ? () => onRowMouseEnter(id) : undefined}
                onClick={onRowClick ? (e) => onRowClick(row, e) : undefined}
                onDoubleClick={onRowDoubleClick ? (e) => onRowDoubleClick(row, e) : undefined}
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
    content = contextMenu ? (
      <ContextMenu>
        {/* Single scroll container (both axes) via containerClassName — see Table's doc comment in
            components/ui/table.tsx for why a second overflow-y-auto wrapper would break the
            header's sticky positioning. */}
        <ContextMenuTrigger asChild onContextMenu={handleTableContextMenu}>
          {table}
        </ContextMenuTrigger>
        <ContextMenuContent key={contextMenuAnchorKey}>
          {contextMenu(rows.filter((r) => contextIds.includes(getRowId(r)))).map((item) =>
            "separator" in item ? (
              <ContextMenuSeparator key={item.key} />
            ) : (
              <ContextMenuItem
                key={item.key}
                variant={item.destructive ? "destructive" : "default"}
                disabled={item.disabled}
                onClick={() => item.onSelect(rows.filter((r) => contextIds.includes(getRowId(r))))}
              >
                {item.icon}
                {item.label}
              </ContextMenuItem>
            ),
          )}
        </ContextMenuContent>
      </ContextMenu>
    ) : (
      table
    )
  }

  const region = <div className="min-h-0 flex-1">{content}</div>
  const selectedId = mode === "single" ? pageIds.find((id) => selection.selected.has(id)) : undefined

  const hasToolbar = toolbar != null || filters != null || search != null
  const showPagination = pagination != null && !loading && !error

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-6", className)}>
      {hasToolbar && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {toolbar != null && renderSlot(toolbar)}
          {filters != null && <div className="ml-auto flex flex-wrap items-center gap-2">{renderSlot(filters)}</div>}
          {search && <TableSearch {...search} className={filters == null ? "ml-auto" : undefined} />}
        </div>
      )}
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
      {showPagination && <TablePagination {...pagination} selectedCount={mode === "multi" ? selectedRows.length : 0} />}
    </div>
  )
}

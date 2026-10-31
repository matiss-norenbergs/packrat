import { memo, useLayoutEffect, useMemo, useRef, useState } from "react"
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
import { isRowEventIgnored } from "./interactive"
import { ALIGN_CLASS, JUSTIFY_CLASS, SELECTION_COLUMN_WIDTH, computeLayout, resolveAlign } from "./columns"
import type { ColumnDef, ContextMenuItemDef, PaginationConfig, RowId, SearchConfig, SelectionColumnConfig } from "./types"
import { useEvent } from "./useEvent"
import { useTableSelection } from "./useTableSelection"
import type { SelectionMode } from "./useTableSelection"

export interface SlotContext<T, Id extends RowId> {
  selection: IdSelection<Id>
  /** The selected rows that are on the current page. */
  selectedRows: T[]
  /** The active search query as typed (debounced). */
  query: string
  /** Rows across all pages after filtering (the footer total). */
  total: number
}
export type Slot<T, Id extends RowId> = ReactNode | ((ctx: SlotContext<T, Id>) => ReactNode)

export interface DataTableProps<T, Id extends RowId = number> {
  /**
   * Controlled mode (default): the CURRENT page's rows — the page owns filtering and slicing (use for server paging).
   * Client-side mode (`pageSize` and/or `search.match` given): ALL rows; the table filters, pages and resets for you.
   */
  rows: T[]
  getRowId: (row: T) => Id
  /**
   * Memoize this (`useMemo`, with correct deps) or define it at module level: rows are `React.memo`'d and a
   * new `columns` array re-renders every row and cell on every render of the page. Row/cell handlers and
   * `rowClassName` are fine inline.
   */
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
  search?: SearchConfig<T>
  /** Controlled mode only: footer state owned by the page. */
  pagination?: PaginationConfig
  /** Client-side mode: rows per page (50 by repo convention). Without it all filtered rows are shown. */
  pageSize?: number
  /** Client-side mode: footer label; the footer is shown only when `pageSize` and `itemLabel` are both set. */
  itemLabel?: { singular: string; plural: string }
  /**
   * Client-side mode: for a filter the page applies to `rows` itself (e.g. a status Select). When this value changes
   * the table goes back to page 1 and clears the selection, like it does for its own search. Compared with
   * `Object.is`; an unchanged value does nothing.
   */
  resetKey?: unknown
  /** Right-click menu, built from the rows it applies to. Right-clicking the header or an empty area opens nothing. */
  contextMenu?: (rows: T[]) => ContextMenuItemDef<T>[]
  onRowClick?: (row: T, e: MouseEvent<HTMLTableRowElement>) => void
  onRowDoubleClick?: (row: T, e: MouseEvent<HTMLTableRowElement>) => void
  loading?: boolean
  /** Number of skeleton bars shown while loading. */
  loadingRows?: number
  /** Replaces the default skeleton bars while `loading` (e.g. skeletons with the padding of a bordered box). */
  loadingContent?: ReactNode
  /** Replaces the table (e.g. a load failure message). */
  error?: ReactNode
  /** Shown instead of the table when there are no rows; a function receives the active query ("" when none). */
  empty?: ReactNode | ((query: string) => ReactNode)
  rowClassName?: (row: T) => string | undefined
  className?: string
  /**
   * Merged onto the content region wrapper (default `min-h-0 flex-1`) that holds the loading / error / empty state or
   * the table, so a dialog can give all of them one fixed or capped height and a border (`h-[60vh] overflow-hidden
   * rounded-md border`) and the box never resizes between states. Pair it with a `containerClassName` that fills it.
   */
  regionClassName?: string
  /** Replaces the scroll container's classes entirely (see Table in components/ui/table.tsx). */
  containerClassName?: string
  /**
   * Client-side and controlled mode: don't render the pagination footer while everything fits on one page (the
   * default is to always show it, even at 0 results). It reappears as soon as there is a second page.
   */
  hideSinglePageFooter?: boolean
}

// Rendered inside ContextMenuContent, which Radix only mounts while the menu is open, so the page's
// builder runs on demand instead of on every table render.
function ContextMenuItems<T, Id extends RowId>({
  rows,
  getRowId,
  ids,
  build,
}: {
  rows: T[]
  getRowId: (row: T) => Id
  ids: Id[]
  build: (rows: T[]) => ContextMenuItemDef<T>[]
}) {
  const menuRows = rows.filter((r) => ids.includes(getRowId(r)))
  return build(menuRows).map((item) =>
    "separator" in item ? (
      <ContextMenuSeparator key={item.key} />
    ) : (
      <ContextMenuItem
        key={item.key}
        variant={item.destructive ? "destructive" : "default"}
        disabled={item.disabled}
        onClick={() => item.onSelect(menuRows)}
      >
        {item.icon}
        {item.label}
      </ContextMenuItem>
    ),
  )
}

interface DataTableRowProps<T, Id extends RowId> {
  row: T
  id: Id
  selected: boolean
  mode: SelectionMode
  columns: ColumnDef<T>[]
  className: string
  label: string
  onMouseDown: (e: MouseEvent, id: Id) => void
  onMouseEnter: (id: Id) => void
  onToggle: (id: Id) => void
  onClick: (row: T, e: MouseEvent<HTMLTableRowElement>) => void
  onDoubleClick: (row: T, e: MouseEvent<HTMLTableRowElement>) => void
}

// Memoized so a selection change or a drag re-renders only the rows whose `selected` flipped, not every row and
// cell. Everything it receives is primitive or has a stable identity (the parent's handlers go through useEvent;
// `columns` is the page's to memoize — see DataTableProps.columns).
function DataTableRowImpl<T, Id extends RowId>({
  row,
  id,
  selected,
  mode,
  columns,
  className,
  label,
  onMouseDown,
  onMouseEnter,
  onToggle,
  onClick,
  onDoubleClick,
}: DataTableRowProps<T, Id>) {
  const selectable = mode !== "none"
  return (
    <TableRow
      data-row-id={String(id)}
      data-state={selected ? "selected" : undefined}
      aria-selected={selectable ? selected : undefined}
      className={className}
      onMouseDown={selectable ? (e) => onMouseDown(e, id) : undefined}
      onMouseEnter={selectable ? () => onMouseEnter(id) : undefined}
      onClick={(e) => !isRowEventIgnored(e) && onClick(row, e)}
      onDoubleClick={(e) => !isRowEventIgnored(e) && onDoubleClick(row, e)}
    >
      {selectable && (
        <TableCell className={cn("text-center", mode === "single" && "pr-0")}>
          {mode === "multi" ? (
            <Checkbox checked={selected} onCheckedChange={() => onToggle(id)} aria-label={label} />
          ) : (
            <RadioGroupItem value={String(id)} aria-label={label} />
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
}
const DataTableRow = memo(DataTableRowImpl) as typeof DataTableRowImpl

const CONTAINER_CLASS = "h-full overflow-auto rounded-md border"

export function DataTable<T, Id extends RowId = number>({
  rows: allRows,
  getRowId,
  columns,
  selection: mode = "none",
  selectionState,
  selectionColumn,
  getRowLabel,
  toolbar,
  filters,
  search,
  pagination: controlledPagination,
  pageSize,
  itemLabel,
  resetKey,
  contextMenu,
  onRowClick,
  onRowDoubleClick,
  loading,
  loadingRows = 2,
  loadingContent,
  error,
  empty,
  rowClassName,
  className,
  regionClassName,
  containerClassName,
  hideSinglePageFooter,
}: DataTableProps<T, Id>) {
  const ownSelection = useIdSelection<Id>()
  const selection = selectionState ?? ownSelection

  // Client-side mode. The query/page reset and the selection clear happen in the event
  // handlers that change them (selection is scoped to what's visible), not in effects.
  const match = search?.match
  const clientMode = pageSize != null || match != null
  const [rawQuery, setRawQuery] = useState(search?.value ?? "")
  const [page, setPage] = useState(1)
  const normalizedQuery = rawQuery.trim().toLowerCase()
  const filtered = useMemo(
    () => (clientMode && match && normalizedQuery ? allRows.filter((r) => match(r, normalizedQuery)) : allRows),
    [clientMode, match, normalizedQuery, allRows],
  )
  const rows = clientMode && pageSize != null ? filtered.slice((page - 1) * pageSize, page * pageSize) : clientMode ? filtered : allRows
  const handleSearchChange = (value: string) => {
    search?.onChange?.(value)
    if (!clientMode || value === rawQuery) return
    setRawQuery(value)
    setPage(1)
    selection.clear()
  }
  // A page-owned filter changes `rows` from outside, so there is no handler to hook into: the page snaps back
  // by adjusting state during render (no extra commit). The selection belongs to the page when it passes
  // `selectionState`, and updating another component while rendering is not allowed, so it is cleared in a
  // layout effect (applied before paint).
  const [seenResetKey, setSeenResetKey] = useState(resetKey)
  if (!Object.is(seenResetKey, resetKey)) {
    setSeenResetKey(resetKey)
    setPage(1)
  }
  const clearSelection = useEvent(() => selection.clear())
  const clearedForKey = useRef(resetKey)
  useLayoutEffect(() => {
    if (Object.is(clearedForKey.current, resetKey)) return
    clearedForKey.current = resetKey
    clearSelection()
  }, [resetKey, clearSelection])
  const goToPage = (p: number) => {
    setPage(p)
    selection.clear()
  }
  const pagination: PaginationConfig | undefined = clientMode
    ? pageSize != null && itemLabel
      ? { page, pageSize, total: filtered.length, onPageChange: goToPage, itemLabel }
      : undefined
    : controlledPagination
  const query = clientMode ? rawQuery : (search?.value ?? "")
  const { onRowMouseDown, onRowMouseEnter } = useTableSelection({ rows, getRowId, mode, selection })

  // Stable wrappers around the page's (usually inline) handlers, so they never defeat the row memo.
  const toggleRow = useEvent((id: Id) => selection.toggle(id))
  const handleRowClick = useEvent((row: T, e: MouseEvent<HTMLTableRowElement>) => onRowClick?.(row, e))
  const handleRowDoubleClick = useEvent((row: T, e: MouseEvent<HTMLTableRowElement>) => onRowDoubleClick?.(row, e))

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
  const slotCtx = { selection, selectedRows, query, total: pagination?.total ?? rows.length }
  const renderSlot = (slot: Slot<T, Id>) => (typeof slot === "function" ? slot(slotCtx) : slot)

  let content: ReactNode
  if (loading) {
    content =
      loadingContent ?? (
        <div className="space-y-2">
          {Array.from({ length: loadingRows }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )
  } else if (error) {
    content = error
  } else if (rows.length === 0) {
    content = typeof empty === "function" ? empty(query) : (empty ?? null)
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
            return (
              <DataTableRow
                key={String(id)}
                row={row}
                id={id}
                selected={selection.isSelected(id)}
                mode={mode}
                columns={columns}
                className={cn(selectable ? "cursor-default select-none" : onRowClick && "cursor-pointer", rowClassName?.(row))}
                label={rowLabel(row, id)}
                onMouseDown={onRowMouseDown}
                onMouseEnter={onRowMouseEnter}
                onToggle={toggleRow}
                onClick={handleRowClick}
                onDoubleClick={handleRowDoubleClick}
              />
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
          <ContextMenuItems rows={rows} getRowId={getRowId} ids={contextIds} build={contextMenu} />
        </ContextMenuContent>
      </ContextMenu>
    ) : (
      table
    )
  }

  const region = <div className={cn("min-h-0 flex-1", regionClassName)}>{content}</div>
  const selectedId = mode === "single" ? pageIds.find((id) => selection.selected.has(id)) : undefined

  const hasToolbar = toolbar != null || filters != null || search != null
  // A page past the end still renders the footer for one commit so TablePagination can snap it back.
  const singlePage = pagination != null && pagination.page <= 1 && pagination.total <= pagination.pageSize
  const showPagination = pagination != null && !loading && !error && !(hideSinglePageFooter && singlePage)

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-6", className)}>
      {hasToolbar && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {toolbar != null && renderSlot(toolbar)}
          {filters != null && <div className="ml-auto flex flex-wrap items-center gap-2">{renderSlot(filters)}</div>}
          {search && (
            <TableSearch
              value={clientMode ? rawQuery : (search.value ?? "")}
              onChange={handleSearchChange}
              placeholder={search.placeholder}
              debounceMs={search.debounceMs}
              className={filters == null ? "ml-auto" : undefined}
            />
          )}
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

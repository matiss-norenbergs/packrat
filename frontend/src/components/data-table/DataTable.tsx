import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { MouseEvent, ReactNode } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { Checkbox } from "@/components/ui/checkbox"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useIdSelection } from "@/hooks/useIdSelection"
import type { IdSelection } from "@/hooks/useIdSelection"
import { useTableLayout } from "@/hooks/useTableLayout"
import type { TableLayout } from "@/types/api"
import { cn } from "@/lib/utils"
import { TablePagination } from "./TablePagination"
import { TableSearch } from "./TableSearch"
import { ButtonGroup } from "@/components/ui/button-group"
import { ColumnsMenu, LayoutPopover } from "./TableLayoutControls"
import { isRowEventIgnored } from "./interactive"
import { ALIGN_CLASS, JUSTIFY_CLASS, SELECTION_COLUMN_WIDTH, clipClass, columnMinWidth, columnWidth, computeLayout, effectiveColumnWidth, isResizable, resolveAlign } from "./columns"
import type { ColumnAlign, ColumnDef, ContextMenuItemDef, PaginationConfig, RowId, SearchConfig, SelectionColumnConfig } from "./types"
import { cycleLayoutSort, effectiveSort, sortRows } from "./sorting"
import type { SortDir, SortState } from "./sorting"
import { useColumnResize } from "./useColumnResize"
import type { ColumnResizeHandleProps } from "./useColumnResize"
import { useEvent } from "./useEvent"
import { useOverflowTooltip } from "./useOverflowTooltip"
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
   * Stable id that lets the user save this table's layout (hidden columns) to their account: adds the Layout
   * popover (Save / Restore / Clear) at the end of the toolbar, with the Columns menu when there are hideable
   * columns, and makes the columns resizable (see `ColumnDef.resizable`). Needs at least one `hideable`, `sortValue`
   * or resizable column. Not for tables in dialogs.
   */
  tableId?: string
  /**
   * Controlled layout: when both are passed the page owns the working layout (what the user has now, never saved
   * automatically) and DataTable only reads it and reports edits. Without them DataTable keeps it internally.
   * `hidden`, `sort` and `widths` (overrides of the default column widths) are edited here. In controlled-rows (server) mode the table never sorts rows: read `layout.sort` (or the default) and sort on the server.
   */
  layout?: TableLayout
  onLayoutChange?: (layout: TableLayout) => void
  /**
   * The table's natural order, shown while the user has not picked another sort (and the one a sort cycle returns to).
   * Set it only where it reproduces the order of `rows` exactly; leave it unset for "whatever order `rows` has".
   */
  defaultSort?: SortState
  /**
   * Default: every row is selectable. A row that returns false keeps its place but is never selected: its checkbox /
   * radio is disabled; a click, ctrl / cmd click, drag or shift range skips it; select-all, the header checkbox, the
   * footer count and the toolbar's `selectedRows` consider only the selectable rows; right-clicking it leaves the
   * selection alone (the context menu acts on that row only). `onRowClick` / `onRowDoubleClick` still fire. Styling it
   * (dimming) is the page's job, through `rowClassName`.
   */
  isRowSelectable?: (row: T) => boolean
}

/** What the table needs from its layout state; built by the wrappers at the bottom of the file. */
interface LayoutCtl {
  hidden: ReadonlySet<string>
  toggle: (key: string) => void
  /** The sort shown: the working one, else the default, else none. */
  sort?: SortState
  /** A header click: moves the sort of that column one step along the cycle (see `nextSort`). */
  toggleSort: (key: string) => void
  /** The saved layouts have not arrived yet: the table shows its loading state instead of flashing the defaults. */
  pending?: boolean
  /** Width overrides of the working layout, by column key. Only a table with a tableId resizes. */
  widths?: Readonly<Record<string, number>>
  /** Sets one column's width (px) in the working layout; a width equal to the column's default removes the override. */
  setWidth?: (key: string, px: number) => void
  /** Present when the table has a tableId. */
  saved?: { dirty: boolean; hasSaved: boolean; save: () => void; restore: () => void; clear: () => void }
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
  /** False for a row `isRowSelectable` rules out: no checkbox / radio, no press handlers. */
  canSelect: boolean
  mode: SelectionMode
  columns: ColumnDef<T>[]
  /** Ends the row with an empty filler cell (the table has no flex column). */
  filler: boolean
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
  canSelect,
  mode,
  columns,
  filler,
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
      onMouseDown={selectable && canSelect ? (e) => onMouseDown(e, id) : undefined}
      onMouseEnter={selectable && canSelect ? () => onMouseEnter(id) : undefined}
      onClick={(e) => !isRowEventIgnored(e) && onClick(row, e)}
      onDoubleClick={(e) => !isRowEventIgnored(e) && onDoubleClick(row, e)}
    >
      {selectable && (
        <TableCell className={cn("text-center", mode === "single" && "pr-0")}>
          {mode === "multi" ? (
            <Checkbox checked={selected} disabled={!canSelect} onCheckedChange={() => onToggle(id)} aria-label={label} />
          ) : (
            <RadioGroupItem value={String(id)} disabled={!canSelect} aria-label={label} />
          )}
        </TableCell>
      )}
      {columns.map((c) => {
        const align = resolveAlign(c)
        // Bare SVGs are display:block under preflight, so text-center can't centre
        // them; icon cells get a flex wrapper instead of every page needing mx-auto.
        const cell = c.cell(row)
        return (
          <TableCell key={c.key} data-col={c.key} className={cn(ALIGN_CLASS[align], clipClass(c), c.cellClassName)}>
            {c.type === "icon" ? <div className={cn("flex items-center", JUSTIFY_CLASS[align])}>{cell}</div> : cell}
          </TableCell>
        )
      })}
      {filler && <TableCell aria-hidden className="p-0" />}
    </TableRow>
  )
}
const DataTableRow = memo(DataTableRowImpl) as typeof DataTableRowImpl

const CONTAINER_CLASS = "h-full overflow-auto rounded-md border"

// The header of a sortable column, drawn like the Library list's (label, arrow next to it). A right-aligned column
// puts the arrow before the label so the label stays flush right; a centered one keeps a spacer of the arrow's
// width on the other side so the label stays centered whether or not the arrow shows.
function SortButton({ align, dir, onClick, children }: { align: ColumnAlign; dir: SortDir | undefined; onClick: () => void; children: ReactNode }) {
  const Arrow = dir === "asc" ? ArrowUp : ArrowDown
  const arrow = dir ? <Arrow className="h-3 w-3 shrink-0" /> : <span className="h-3 w-3 shrink-0" />
  return (
    <button
      type="button"
      data-sort-button
      className="inline-flex max-w-full cursor-pointer select-none items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={onClick}
    >
      {align === "right" ? (dir ? arrow : null) : align === "center" ? <span className="h-3 w-3 shrink-0" /> : null}
      <span className="min-w-0 truncate">{children}</span>
      {align === "right" ? null : align === "center" ? arrow : dir ? arrow : null}
    </button>
  )
}

// The drag zone on a header cell's right edge (inside the cell, which clips its overflow). A sibling of the sort button,
// so pressing it never sorts. Not focusable and no keyboard support: Restore and Clear in the Layout popover are the
// way back to the default widths. The 1 px line only shows while the header is hovered.
function ResizeHandle({ name, active, ...handlers }: ColumnResizeHandleProps & { name: string; active: boolean }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${name} column`}
      data-resize-handle
      data-resizing={active ? "" : undefined}
      className="group/handle absolute inset-y-0 right-0 flex w-2 cursor-col-resize touch-none select-none justify-end"
      {...handlers}
    >
      <span className="pointer-events-none my-2 w-px bg-transparent group-hover/th:bg-border group-hover/handle:bg-muted-foreground/50 group-data-[resizing]/handle:bg-muted-foreground" />
    </div>
  )
}

// Runs `resetPage` while rendering (a state adjustment, no extra commit) and `clear` in a layout effect (before paint)
// when `value` changes (`Object.is`); an unchanged value does nothing. Not on mount.
function useResetOnChange(value: unknown, resetPage: () => void, clear: () => void) {
  const [seen, setSeen] = useState(value)
  if (!Object.is(seen, value)) {
    setSeen(value)
    resetPage()
  }
  const cleared = useRef(value)
  const clearLatest = useEvent(clear)
  useLayoutEffect(() => {
    if (Object.is(cleared.current, value)) return
    cleared.current = value
    clearLatest()
  }, [value, clearLatest])
}

function DataTableView<T, Id extends RowId = number>({
  layoutCtl,
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
  isRowSelectable,
}: DataTableProps<T, Id> & { layoutCtl: LayoutCtl | null }) {
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
  // Sorting happens here only in client-side mode, on the filtered rows and before paging, so ranges and drags
  // follow the displayed order. A controlled (server) table never sorts: the page reads the sort from the layout.
  const sort = layoutCtl?.sort
  const sortValue = sort ? columns.find((c) => c.key === sort.key)?.sortValue : undefined
  const sortDir = sort?.dir
  const sorted = useMemo(
    () => (clientMode && sortValue && sortDir ? sortRows(filtered, sortValue, sortDir) : filtered),
    [clientMode, sortValue, sortDir, filtered],
  )
  const rows = clientMode && pageSize != null ? sorted.slice((page - 1) * pageSize, page * pageSize) : clientMode ? sorted : allRows
  // Controlled mode: the query the page was last told about (only used to notice a change; the page owns the filtering).
  const [reportedQuery, setReportedQuery] = useState(search?.value ?? "")
  const handleSearchChange = (value: string) => {
    search?.onChange?.(value)
    if (!clientMode) setReportedQuery(value)
    if (!clientMode || value === rawQuery) return
    setRawQuery(value)
    setPage(1)
    selection.clear()
  }
  // A page-owned filter changes `rows` from outside, so there is no handler to hook into: the page snaps back
  // by adjusting state during render (no extra commit). The selection belongs to the page when it passes
  // `selectionState`, and updating another component while rendering is not allowed, so it is cleared in a
  // layout effect (applied before paint).
  // The same goes for a sort change, however it came about (header click, Restore, Clear, a saved layout arriving):
  // the effective sort is part of the key. Only client-side mode resets; a controlled page does its own.
  const clearSelection = useEvent(() => selection.clear())
  useResetOnChange(resetKey, () => setPage(1), clearSelection)
  useResetOnChange(sort ? `${sort.key}:${sort.dir}` : "", () => clientMode && setPage(1), () => clientMode && clearSelection())
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

  // A new page, sort, search or resetKey starts at the top of the scroll container. Compared on every render (a layout
  // effect, so before paint and without an extra render); not on mount, and never for a refetch, a selection change, a
  // hidden column or a resize, none of which is in the key. Only scrollTop is touched, so scrollLeft stays.
  const regionRef = useRef<HTMLDivElement>(null)
  const scrollKey = useRef<unknown[] | null>(null)
  useLayoutEffect(() => {
    const next = [pagination?.page, sort ? `${sort.key}:${sort.dir}` : "", clientMode ? rawQuery : reportedQuery, resetKey]
    const prev = scrollKey.current
    scrollKey.current = next
    if (!prev || next.every((v, i) => Object.is(v, prev[i]))) return
    const container = regionRef.current?.querySelector<HTMLElement>('[data-slot="table-container"]')
    if (container) container.scrollTop = 0
  })
  const { onRowMouseDown, onRowMouseEnter } = useTableSelection({ rows, getRowId, mode, selection, isSelectable: isRowSelectable })

  // Stable wrappers around the page's (usually inline) handlers, so they never defeat the row memo.
  const toggleRow = useEvent((id: Id) => selection.toggle(id))
  const handleRowClick = useEvent((row: T, e: MouseEvent<HTMLTableRowElement>) => onRowClick?.(row, e))
  const handleRowDoubleClick = useEvent((row: T, e: MouseEvent<HTMLTableRowElement>) => onRowDoubleClick?.(row, e))

  const selectable = mode !== "none"
  const selectionWidth = selectionColumn?.width ?? SELECTION_COLUMN_WIDTH
  // Hidden columns leave the header, the cells and the colgroup alike. Only hideable columns can be hidden, and
  // `columns` itself is passed on when nothing is hidden, so the rows' memo only breaks on an actual toggle.
  const hiddenKey = layoutCtl ? columns.filter((c) => c.hideable && layoutCtl.hidden.has(c.key)).map((c) => c.key).join("\0") : ""
  const visibleColumns = useMemo(() => {
    if (!hiddenKey) return columns
    const hidden = new Set(hiddenKey.split("\0"))
    return columns.filter((c) => !hidden.has(c.key))
  }, [columns, hiddenKey])
  // The width being dragged replaces the working one for the header, the colgroup and the min-width only; the rows are
  // memoized on props this does not touch. It reaches the layout on release.
  const setWidth = useEvent((key: string, px: number) => layoutCtl?.setWidth?.(key, px))
  const resize = useColumnResize(setWidth)
  const widths = layoutCtl?.widths
  const liveWidths = resize.drag ? { ...widths, [resize.drag.key]: resize.drag.width } : widths
  const layout = computeLayout(visibleColumns, selectable ? selectionWidth : null, liveWidths)

  const pageIds = rows.map(getRowId)
  // Only the selectable rows of the page count for select-all, the header checkbox, the footer and the toolbar.
  const selectableRows = isRowSelectable ? rows.filter(isRowSelectable) : rows
  const selectableIds = isRowSelectable ? selectableRows.map(getRowId) : pageIds
  const overflowTip = useOverflowTooltip(visibleColumns, (id) => rows.find((r) => String(getRowId(r)) === id))
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selection.selected.has(id))
  const someSelected = selectableIds.some((id) => selection.selected.has(id)) && !allSelected

  const rowLabel = (row: T, id: Id) => (getRowLabel ? getRowLabel(row) : `Select row ${String(id)}`)

  const selectionHeader =
    selectionColumn?.header ??
    (mode === "multi" ? (
      <Checkbox
        checked={allSelected ? true : someSelected ? "indeterminate" : false}
        onCheckedChange={(checked) => (checked ? selection.selectAll(selectableIds) : selection.clear())}
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
    if (!selectable || (isRowSelectable && !isRowSelectable(rows[pageIds.indexOf(id)]))) {
      setContextIds([id])
    } else if (selection.isSelected(id)) {
      setContextIds(selectableIds.filter((pid) => selection.isSelected(pid)))
    } else {
      selection.selectOnly(id)
      setContextIds([id])
    }
    setContextMenuAnchorKey((k) => k + 1)
  }

  const selectedRows = selectableRows.filter((r) => selection.isSelected(getRowId(r)))
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
        className="table-fixed"
        style={{ minWidth: layout.minWidth }}
      >
        <colgroup>
          {selectable && <col style={{ width: selectionWidth }} />}
          {visibleColumns.map((c, i) => (
            <col key={c.key} style={layout.colWidths[i] != null ? { width: layout.colWidths[i] } : undefined} />
          ))}
          {layout.filler && <col />}
        </colgroup>
        <TableHeader {...overflowTip.headProps}>
          <TableRow>
            {selectable && <TableHead className="text-center">{selectionHeader}</TableHead>}
            {visibleColumns.map((c) => {
              const align = resolveAlign(c)
              const sortable = layoutCtl != null && c.sortValue != null
              const dir = sort?.key === c.key ? sort.dir : undefined
              const resizable = layoutCtl?.setWidth != null && isResizable(c)
              return (
                <TableHead
                  key={c.key}
                  data-col={c.key}
                  // The handle's own label would otherwise end up in the header's accessible name.
                  aria-label={resizable && (typeof c.header === "string" || c.label != null) ? columnLabel(c) : undefined}
                  className={cn(ALIGN_CLASS[align], clipClass(c), resizable && "group/th relative", c.headerClassName)}
                  aria-sort={sortable ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : undefined}
                >
                  {sortable ? (
                    <SortButton align={align} dir={dir} onClick={() => layoutCtl.toggleSort(c.key)}>
                      {c.header}
                    </SortButton>
                  ) : (
                    c.header
                  )}
                  {resizable && (
                    <ResizeHandle
                      name={columnLabel(c)}
                      active={resize.drag?.key === c.key}
                      {...resize.handleProps(c.key, effectiveColumnWidth(c, widths), columnMinWidth(c))}
                    />
                  )}
                </TableHead>
              )
            })}
            {layout.filler && <TableHead aria-hidden className="p-0" />}
          </TableRow>
        </TableHeader>
        <TableBody {...overflowTip.bodyProps}>
          {rows.map((row) => {
            const id = getRowId(row)
            const canSelect = isRowSelectable ? isRowSelectable(row) : true
            return (
              <DataTableRow
                key={String(id)}
                row={row}
                id={id}
                selected={canSelect && selection.isSelected(id)}
                canSelect={canSelect}
                mode={mode}
                columns={visibleColumns}
                filler={layout.filler}
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

  const region = (
    <div ref={regionRef} className={cn("min-h-0 flex-1", regionClassName)}>
      {content}
    </div>
  )
  const selectedId = mode === "single" ? selectableIds.find((id) => selection.selected.has(id)) : undefined

  const columnItems = layoutCtl
    ? columns.filter((c) => c.hideable).map((c) => ({ key: c.key, label: columnLabel(c), visible: !layoutCtl.hidden.has(c.key) }))
    : []
  const hasColumnsMenu = layoutCtl != null && columnItems.length > 0
  const hasLayoutButton = layoutCtl?.saved != null
  const hasToolbar = toolbar != null || filters != null || search != null || hasColumnsMenu || hasLayoutButton
  // The first element on the right edge takes the spare space (ml-auto); filters, search, then the Columns / Layout group.
  const rightStart = filters != null ? "filters" : search ? "search" : "group"
  const showPagination = pagination != null
  const pending = Boolean(loading || error)

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-6", className)}>
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
              className={rightStart === "search" ? "ml-auto" : undefined}
            />
          )}
          {(hasColumnsMenu || hasLayoutButton) && (
            <ButtonGroup className={rightStart === "group" ? "ml-auto" : undefined}>
              {hasColumnsMenu && <ColumnsMenu items={columnItems} onToggle={layoutCtl.toggle} />}
              {layoutCtl.saved && (
                <LayoutPopover
                  dirty={layoutCtl.saved.dirty}
                  hasSaved={layoutCtl.saved.hasSaved}
                  onSave={layoutCtl.saved.save}
                  onRestore={layoutCtl.saved.restore}
                  onClear={layoutCtl.saved.clear}
                />
              )}
            </ButtonGroup>
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
      {overflowTip.node}
      {showPagination && <TablePagination {...pagination} selectedCount={mode === "multi" ? selectedRows.length : 0} loading={pending} />}
    </div>
  )
}

function columnLabel<T>(c: ColumnDef<T>): string {
  return c.label ?? (typeof c.header === "string" ? c.header : c.key)
}

function defaultLayout<T>(columns: ColumnDef<T>[]): TableLayout {
  const hidden = columns.filter((c) => c.hideable && c.defaultVisible === false).map((c) => c.key)
  return hidden.length ? { v: 1, hidden } : { v: 1 }
}

function defaultLayoutSort(layout: TableLayout, defaultSort: SortState | undefined) {
  return effectiveSort(layout.sort, defaultSort)
}

function withColumnWidth<T>(layout: TableLayout, column: ColumnDef<T>, px: number): TableLayout {
  const widths = { ...layout.widths }
  if (px === columnWidth(column)) delete widths[column.key]
  else widths[column.key] = px
  const { widths: _old, ...rest } = layout
  return Object.keys(widths).length ? { ...rest, widths } : rest
}

function toggleHidden(layout: TableLayout, key: string): TableLayout {
  const hidden = new Set(layout.hidden ?? [])
  if (!hidden.delete(key)) hidden.add(key)
  const { hidden: _old, ...rest } = layout
  return hidden.size ? { ...rest, hidden: [...hidden] } : rest
}

// Layout state with a tableId: the account's saved layout, a working copy, and Save / Restore / Clear.
function DataTableWithSavedLayout<T, Id extends RowId>({ tableId, layout, onLayoutChange, ...props }: DataTableProps<T, Id> & { tableId: string }) {
  const { columns, defaultSort } = props
  const defaults = useMemo(() => defaultLayout(columns), [columns])
  const knownKeys = useMemo(() => columns.map((c) => c.key), [columns])
  const hideableKeys = useMemo(() => columns.filter((c) => c.hideable).map((c) => c.key), [columns])
  const sortableKeys = useMemo(() => columns.filter((c) => c.sortValue).map((c) => c.key), [columns])
  // Default and minimum of every column the user can resize: what `widths` is normalized against.
  const resizableWidths = useMemo(
    () => Object.fromEntries(columns.filter(isResizable).map((c) => [c.key, { default: columnWidth(c), min: columnMinWidth(c) }])),
    [columns],
  )
  const state = useTableLayout(tableId, defaults, {
    knownKeys,
    hideableKeys,
    sortableKeys,
    defaultSort,
    resizableWidths,
    controlled: layout && onLayoutChange ? { working: layout, onChange: onLayoutChange } : undefined,
  })
  const { working, setWorking, dirty, hasSaved, save, restore, clear } = state
  // Rebuilt every render on purpose: only `visibleColumns` (memoized by content) reaches the memoized rows.
  const ctl: LayoutCtl = {
    hidden: new Set(working.hidden ?? []),
    pending: !state.ready,
    toggle: (key) => setWorking((prev) => toggleHidden(prev, key)),
    sort: defaultLayoutSort(working, defaultSort),
    toggleSort: (key) => setWorking((prev) => cycleLayoutSort(prev, key, defaultSort)),
    widths: working.widths,
    setWidth: (key, px) => {
      const column = columns.find((c) => c.key === key)
      if (column && isResizable(column)) setWorking((prev) => withColumnWidth(prev, column, px))
    },
    saved: { dirty, hasSaved, save: () => void save(), restore, clear: () => void clear() },
  }
  return <DataTableView {...props} loading={props.loading || ctl.pending} layoutCtl={ctl} />
}

// No tableId: hiding works (Columns menu) but is never saved; the working layout is the page's or ours.
function DataTableWithLocalLayout<T, Id extends RowId>({ layout, onLayoutChange, ...props }: DataTableProps<T, Id>) {
  const { columns } = props
  const [own, setOwn] = useState<TableLayout | null>(null)
  const controlled = layout != null && onLayoutChange != null
  const working = controlled ? layout : (own ?? defaultLayout(columns))
  const setWorking = controlled ? onLayoutChange : setOwn
  const { defaultSort } = props
  const ctl: LayoutCtl = {
    hidden: new Set(working.hidden ?? []),
    toggle: (key) => setWorking(toggleHidden(working, key)),
    sort: defaultLayoutSort(working, defaultSort),
    toggleSort: (key) => setWorking(cycleLayoutSort(working, key, defaultSort)),
  }
  return <DataTableView {...props} layoutCtl={ctl} />
}

export function DataTable<T, Id extends RowId = number>(props: DataTableProps<T, Id>) {
  const { columns, tableId } = props
  // A hideable or a sortable column makes the table keep a layout (the Columns menu needs a hideable one); so does a
  // resizable one, but only with a tableId (without it nothing is saved, so the table does not resize at all).
  const hasLayout = columns.some((c) => c.hideable || c.sortValue || (tableId && isResizable(c)))
  useEffect(() => {
    if (!import.meta.env.DEV) return
    for (const c of columns) {
      if (c.hideable && c.label == null && typeof c.header !== "string") {
        console.warn(`DataTable: hideable column "${c.key}" needs a label (its header is not a string)`)
      }
    }
  }, [columns])
  if (!hasLayout) return <DataTableView {...props} layoutCtl={null} />
  if (tableId) return <DataTableWithSavedLayout {...props} tableId={tableId} />
  return <DataTableWithLocalLayout {...props} />
}

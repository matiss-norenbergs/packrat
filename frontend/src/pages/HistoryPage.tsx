import { useEffect, useMemo, useRef, useState } from "react"
import { ImageIcon, RotateCcw, Search, Trash2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useBulkDeleteHistoryItems, useBulkRetryHistoryItems, useHistory } from "@/hooks/useHistory"
import { getPageNumbers } from "@/lib/pagination"
import { formatDownloadStatus } from "@/lib/utils"
import type { HistoryItem } from "@/types/api"

const PAGE_SIZE = 50

// "duplicate" is deliberately excluded — it was never queued, so there's
// nothing to replay.
const RETRYABLE_STATUSES = new Set(["failed", "cancelled", "interrupted"])

const STATUS_VARIANT: Record<string, "success" | "secondary" | "destructive" | "outline"> = {
  completed: "success",
  failed: "destructive",
  cancelled: "outline",
  interrupted: "destructive",
  duplicate: "secondary",
}

export function HistoryPage() {
  const { data, isLoading, isError, error } = useHistory()
  const { selected, isSelected, toggle, clear, selectAll, selectOnly, size, active } = useIdSelection()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const bulkDelete = useBulkDeleteHistoryItems()
  const bulkRetry = useBulkRetryHistoryItems()

  // Drag-to-select: mousedown on a row starts the drag and anchors the
  // range; mouseenter on subsequent rows while the button is held extends
  // the selection to every row between the anchor and the row under the
  // cursor. A window-level mouseup ends the drag even if the button is
  // released outside the table.
  const [isDragging, setIsDragging] = useState(false)
  const dragAnchorIdRef = useRef<number | null>(null)

  // Radix's ContextMenu only computes the floating menu's position when its
  // content actually (re)mounts — keying on this counter forces a fresh
  // remeasure on every right-click, matching Tags/Artists.
  const [contextMenuAnchorKey, setContextMenuAnchorKey] = useState(0)

  // Debounce the value actually used for filtering so fast typing doesn't
  // re-filter/re-paginate on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(id)
  }, [searchInput])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data ?? []
    return (data ?? []).filter((h) => (h.title ?? h.url).toLowerCase().includes(q))
  }, [data, search])
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const allSelected = pageData.length > 0 && pageData.every((h) => selected.has(h.id))
  const someSelected = pageData.some((h) => selected.has(h.id)) && !allSelected

  // Only the retryable ids within the current selection — Delete acts on
  // the whole selection, but Retry silently skips e.g. already-completed
  // entries rather than being disabled outright by one non-retryable pick.
  const retryableSelected = useMemo(
    () => (data ?? []).filter((h) => selected.has(h.id) && RETRYABLE_STATUSES.has(h.status)).map((h) => h.id),
    [data, selected],
  )

  // The selection is scoped to what's currently visible on this page — a
  // stale id from a previous page/search shouldn't silently ride along once
  // the rows it referred to are no longer on screen.
  useEffect(() => {
    clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search])

  // A search that shrinks the result set out from under the current page
  // number would otherwise show an empty page instead of snapping back.
  useEffect(() => {
    setPage(1)
  }, [search])

  useEffect(() => {
    if (!isDragging) return
    const onMouseUp = () => setIsDragging(false)
    window.addEventListener("mouseup", onMouseUp)
    return () => window.removeEventListener("mouseup", onMouseUp)
  }, [isDragging])

  const isCheckboxTarget = (e: React.MouseEvent) => (e.target as HTMLElement).closest('[role="checkbox"]') != null

  const rangeIds = (anchorId: number, targetId: number) => {
    const anchorIdx = pageData.findIndex((h) => h.id === anchorId)
    const targetIdx = pageData.findIndex((h) => h.id === targetId)
    if (anchorIdx === -1 || targetIdx === -1) return null
    const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    return pageData.slice(start, end + 1).map((h) => h.id)
  }

  const handleRowMouseDown = (e: React.MouseEvent, id: number) => {
    if (e.button !== 0 || isCheckboxTarget(e)) return
    e.preventDefault()

    if (e.shiftKey && dragAnchorIdRef.current != null) {
      const ids = rangeIds(dragAnchorIdRef.current, id)
      if (ids) {
        selectAll(ids)
        return
      }
    }

    if (e.ctrlKey || e.metaKey) {
      toggle(id)
      dragAnchorIdRef.current = id
      return
    }

    dragAnchorIdRef.current = id
    setIsDragging(true)
    selectOnly(id)
  }

  const handleRowMouseEnter = (id: number) => {
    if (!isDragging || dragAnchorIdRef.current == null) return
    const ids = rangeIds(dragAnchorIdRef.current, id)
    if (ids) selectAll(ids)
  }

  const handleTableContextMenu = (e: React.MouseEvent) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>("tr[data-history-id]")
    if (!rowEl) {
      e.preventDefault()
      return
    }
    const id = Number(rowEl.dataset.historyId)
    if (!selected.has(id)) selectOnly(id)
    setContextMenuAnchorKey((k) => k + 1)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold">History</h1>
        <p className="text-sm text-muted-foreground">
          A permanent record of every download — unlike the Downloads page, entries here are never
          removed when a download is deleted from the queue.
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={retryableSelected.length === 0}
          onClick={() => bulkRetry.mutate(retryableSelected, { onSuccess: clear })}
        >
          <RotateCcw className="h-4 w-4" />
          Retry
        </Button>

        <Button variant="destructive" size="sm" disabled={!active} onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {size} selected {size === 1 ? "entry" : "entries"}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes them from History. Your library files and downloads are unaffected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  bulkDelete.mutate(Array.from(selected), {
                    onSuccess: () => {
                      clear()
                      setDeleteOpen(false)
                    },
                  })
                }
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="relative ml-auto min-w-[160px] max-w-[280px] flex-1 sm:min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search history…"
            className="pl-8 pr-7"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearchInput("")
                setSearch("")
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Failed to load history: {(error as Error).message}</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing here yet — completed, failed, and cancelled downloads will show up here.
          </p>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground">No history entries match "{search}".</p>
        ) : (
          <ContextMenu>
            <ContextMenuTrigger asChild onContextMenu={handleTableContextMenu}>
              {/* Single scroll container (both axes) via containerClassName — see
                  Table's doc comment in components/ui/table.tsx for why a second
                  overflow-y-auto wrapper would break the header's sticky positioning. */}
              <Table containerClassName="h-full overflow-auto rounded-md border">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 text-center">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        onCheckedChange={(checked) => (checked ? selectAll(pageData.map((h) => h.id)) : clear())}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead className="w-16" />
                    <TableHead>Title</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-center">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageData.map((item) => (
                    <HistoryRow
                      key={item.id}
                      item={item}
                      selected={isSelected(item.id)}
                      onSelectedChange={() => toggle(item.id)}
                      onMouseDown={(e) => handleRowMouseDown(e, item.id)}
                      onMouseEnter={() => handleRowMouseEnter(item.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </ContextMenuTrigger>
            <ContextMenuContent key={contextMenuAnchorKey}>
              <ContextMenuItem
                disabled={retryableSelected.length === 0}
                onClick={() => bulkRetry.mutate(retryableSelected, { onSuccess: clear })}
              >
                <RotateCcw className="h-4 w-4" />
                Retry{retryableSelected.length > 1 ? ` (${retryableSelected.length})` : ""}
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" disabled={!active} onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" />
                Delete{size > 1 ? ` (${size})` : ""}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
      </div>

      {!isLoading && data && data.length > 0 && total > 0 && (
        <div className="flex shrink-0 items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {total} {total === 1 ? "entry" : "entries"}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
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
                  onClick={() => setPage(p)}
                >
                  {p}
                </Button>
              ),
            )}
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function HistoryRow({
  item,
  selected,
  onSelectedChange,
  onMouseDown,
  onMouseEnter,
}: {
  item: HistoryItem
  selected: boolean
  onSelectedChange: () => void
  onMouseDown: (e: React.MouseEvent) => void
  onMouseEnter: () => void
}) {
  return (
    <TableRow
      data-history-id={item.id}
      data-state={selected ? "selected" : undefined}
      className="cursor-default select-none"
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
    >
      <TableCell className="text-center">
        <Checkbox
          checked={selected}
          onCheckedChange={onSelectedChange}
          aria-label={`Select ${item.title ?? item.url}`}
        />
      </TableCell>
      <TableCell>
        <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-muted">
          {item.thumbnail ? (
            <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
            </div>
          )}
        </div>
      </TableCell>
      <TableCell>
        <p className="max-w-xs truncate font-medium">{item.title ?? item.url}</p>
        {(item.status === "failed" || item.status === "duplicate") && item.errorMessage && (
          <p
            className={`max-w-xs truncate text-xs ${item.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {item.errorMessage}
          </p>
        )}
      </TableCell>
      <TableCell className="text-center">
        <Badge variant={STATUS_VARIANT[item.status] ?? "outline"}>{formatDownloadStatus(item.status)}</Badge>
      </TableCell>
      <TableCell className="text-center text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</TableCell>
    </TableRow>
  )
}

import { useEffect, useMemo, useRef, useState } from "react"
import { Eye, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { LogDetailDialog } from "@/components/logs/LogDetailDialog"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useLogs } from "@/hooks/useLogs"
import { getPageNumbers } from "@/lib/pagination"
import { formatDownloadStatus } from "@/lib/utils"
import type { DownloadStatus, LogEntry } from "@/types/api"

const PAGE_SIZE = 50
const NONE = "none"

const STATUS_VARIANT: Record<string, "success" | "secondary" | "destructive" | "outline"> = {
  completed: "success",
  failed: "destructive",
  cancelled: "outline",
  interrupted: "destructive",
}

const STATUS_OPTIONS: DownloadStatus[] = [
  "queued",
  "fetching_metadata",
  "downloading",
  "processing",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]

export function LogsPage() {
  const { data, isLoading, isError, error } = useLogs()
  const { selected, isSelected, toggle, clear, selectAll, selectOnly, size } = useIdSelection()
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState(NONE)
  const [page, setPage] = useState(1)
  const [viewing, setViewing] = useState<LogEntry | null>(null)

  // Drag-to-select: mousedown on a row starts the drag and anchors the
  // range; mouseenter on subsequent rows while the button is held extends
  // the selection to every row between the anchor and the row under the
  // cursor — same convention as History/Tags/Artists.
  const [isDragging, setIsDragging] = useState(false)
  const dragAnchorIdRef = useRef<number | null>(null)

  // Radix's ContextMenu only computes the floating menu's position when its
  // content actually (re)mounts — keying on this counter forces a fresh
  // remeasure on every right-click, matching History/Tags/Artists.
  const [contextMenuAnchorKey, setContextMenuAnchorKey] = useState(0)

  useEffect(() => {
    if (!isDragging) return
    const onMouseUp = () => setIsDragging(false)
    window.addEventListener("mouseup", onMouseUp)
    return () => window.removeEventListener("mouseup", onMouseUp)
  }, [isDragging])

  // The selection is scoped to what's currently visible on this page — a
  // stale id from a previous page/filter shouldn't silently ride along once
  // the rows it referred to are no longer on screen.
  useEffect(() => {
    clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, status])

  const filtered = useMemo(() => {
    return (data ?? []).filter((entry) => {
      if (status !== NONE && entry.status !== status) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const haystack = `${entry.title ?? entry.url} ${entry.ytdlpCommand ?? ""}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [data, search, status])
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const allSelected = pageData.length > 0 && pageData.every((entry) => selected.has(entry.id))
  const someSelected = pageData.some((entry) => selected.has(entry.id)) && !allSelected

  // "View log" only ever targets one entry — with more than one row
  // selected there's no single log to show, so it's disabled rather than
  // guessing which one to open.
  const selectedEntry = size === 1 ? (pageData.find((entry) => selected.has(entry.id)) ?? null) : null
  const selectedHasLog = selectedEntry
    ? Boolean(selectedEntry.ytdlpCommand || selectedEntry.stdoutTail || selectedEntry.stderrTail)
    : false
  const viewLogDisabledReason =
    size === 0 ? "Select a log to view" : size > 1 ? "Select a single log to view" : !selectedHasLog ? "No log captured yet" : null

  const isCheckboxTarget = (e: React.MouseEvent) => (e.target as HTMLElement).closest('[role="checkbox"]') != null

  const rangeIds = (anchorId: number, targetId: number) => {
    const anchorIdx = pageData.findIndex((entry) => entry.id === anchorId)
    const targetIdx = pageData.findIndex((entry) => entry.id === targetId)
    if (anchorIdx === -1 || targetIdx === -1) return null
    const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    return pageData.slice(start, end + 1).map((entry) => entry.id)
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
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>("tr[data-log-id]")
    if (!rowEl) {
      e.preventDefault()
      return
    }
    const id = Number(rowEl.dataset.logId)
    if (!selected.has(id)) selectOnly(id)
    setContextMenuAnchorKey((k) => k + 1)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold">Logs</h1>
        <p className="text-sm text-muted-foreground">
          yt-dlp command, exit code, and captured stdout/stderr for each download.
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              disabled={viewLogDisabledReason != null}
              onClick={() => selectedEntry && setViewing(selectedEntry)}
            >
              <Eye />
              View log
            </Button>
          </TooltipTrigger>
          <TooltipContent>{viewLogDisabledReason ?? "View log"}</TooltipContent>
        </Tooltip>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-full sm:w-[170px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>All statuses</SelectItem>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {formatDownloadStatus(opt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative min-w-[160px] max-w-[280px] flex-1 sm:min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search title, URL, or command…"
              className="pl-8"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Failed to load logs: {(error as Error).message}</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing here yet — logs for each download will show up here once one runs.
          </p>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground">No logs match your search/filter.</p>
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
                        onCheckedChange={(checked) => (checked ? selectAll(pageData.map((entry) => entry.id)) : clear())}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-center">Date</TableHead>
                    <TableHead className="text-right">Retries</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageData.map((entry) => (
                    <LogRow
                      key={entry.id}
                      entry={entry}
                      selected={isSelected(entry.id)}
                      onSelectedChange={() => toggle(entry.id)}
                      onMouseDown={(e) => handleRowMouseDown(e, entry.id)}
                      onMouseEnter={() => handleRowMouseEnter(entry.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </ContextMenuTrigger>
            <ContextMenuContent key={contextMenuAnchorKey}>
              <ContextMenuItem
                disabled={viewLogDisabledReason != null}
                onClick={() => selectedEntry && setViewing(selectedEntry)}
              >
                <Eye /> View log
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
      </div>

      {!isLoading && data && data.length > 0 && total > 0 && (
        <div className="flex shrink-0 items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {total} {total === 1 ? "log" : "logs"}
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

      {viewing && (
        <LogDetailDialog
          entry={viewing}
          open={viewing != null}
          onOpenChange={(open) => !open && setViewing(null)}
        />
      )}
    </div>
  )
}

function LogRow({
  entry,
  selected,
  onSelectedChange,
  onMouseDown,
  onMouseEnter,
}: {
  entry: LogEntry
  selected: boolean
  onSelectedChange: () => void
  onMouseDown: (e: React.MouseEvent) => void
  onMouseEnter: () => void
}) {
  return (
    <TableRow
      data-log-id={entry.id}
      data-state={selected ? "selected" : undefined}
      className="cursor-default select-none"
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
    >
      <TableCell className="text-center">
        <Checkbox checked={selected} onCheckedChange={onSelectedChange} aria-label={`Select ${entry.title ?? entry.url}`} />
      </TableCell>
      <TableCell>
        <p className="max-w-xs truncate font-medium">{entry.title ?? entry.url}</p>
      </TableCell>
      <TableCell className="text-center">
        <Badge variant={STATUS_VARIANT[entry.status] ?? "outline"}>{formatDownloadStatus(entry.status)}</Badge>
      </TableCell>
      <TableCell className="text-center text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</TableCell>
      <TableCell className="text-right text-muted-foreground">{entry.retryCount > 0 ? entry.retryCount : "—"}</TableCell>
    </TableRow>
  )
}

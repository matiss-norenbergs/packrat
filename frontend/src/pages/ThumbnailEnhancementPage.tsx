import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Check, Download, Eye, ListChecks, Loader2, MoreHorizontal, Trash2, Undo2, Wand2 } from "lucide-react"
import { Link } from "react-router-dom"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { EligibleItemsDialog } from "@/components/thumbnailenhance/EligibleItemsDialog"
import { CompareThumbnailDialog } from "@/components/thumbnailenhance/CompareThumbnailDialog"
import {
  useBulkDeleteThumbnailEnhancementHistoryEntries,
  useBulkDeleteThumbnailOriginals,
  useBulkRevertThumbnailOriginals,
  useRedownloadThumbnailsFromOriginal,
  useThumbnailEnhancementActiveItem,
  useThumbnailEnhancementHistory,
  useThumbnailEnhancementStatus,
  useRunThumbnailEnhancementNow,
} from "@/hooks/useThumbnailEnhancement"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useSettings } from "@/hooks/useSettings"
import { enhancementStatusColor, type EnhancementStatusColor } from "@/lib/enhancementStatus"
import { getPageNumbers } from "@/lib/pagination"
import { cn, formatBytes } from "@/lib/utils"
import type { ThumbnailEnhancementHistoryEntry, ThumbnailEnhancementStatus } from "@/types/api"

function dimensions(width: number | null, height: number | null): string {
  return width != null && height != null ? `${width}×${height}` : "—"
}

function ErrorBadge({ error }: { error: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-destructive"
          aria-label="Enhancement failed"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="text-xs text-muted-foreground"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {error}
      </PopoverContent>
    </Popover>
  )
}

// RevertedBadge marks a row whose enhancement was later undone — the
// before/after dimensions and size still shown are a true record of what
// that specific run did, but no longer describe the item's current
// thumbnail.
function RevertedBadge({ revertedAt }: { revertedAt: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Badge
          variant="secondary"
          className="cursor-default"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          Reverted
        </Badge>
      </PopoverTrigger>
      <PopoverContent
        className="text-xs text-muted-foreground"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        Reverted to the original thumbnail on {new Date(revertedAt).toLocaleString()} — this row's
        before/after is preserved for the record, but no longer reflects the item's current
        thumbnail.
      </PopoverContent>
    </Popover>
  )
}

function ItemTitleCell({ entry }: { entry: ThumbnailEnhancementHistoryEntry }) {
  if (entry.libraryItemId == null) return <span>{entry.itemTitle}</span>
  return (
    <Link to={`/library/${entry.libraryItemId}`} className="underline underline-offset-2 hover:text-foreground">
      {entry.itemTitle}
    </Link>
  )
}

// Green/red/grey mirrors the sidebar nav dot — both read the same
// enhancementStatusColor helper so the page and the nav always agree on
// what "active/not reachable/not configured" means.
const STATUS_BADGE_STYLE: Record<EnhancementStatusColor, { variant: "outline" | "destructive" | "secondary"; className: string }> = {
  green: {
    variant: "outline",
    className: "border-transparent bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400",
  },
  red: { variant: "destructive", className: "" },
  grey: { variant: "secondary", className: "" },
}

function statusBadgeProps(status: ThumbnailEnhancementStatus | undefined, isLoading: boolean) {
  const { variant, className } = STATUS_BADGE_STYLE[enhancementStatusColor(status, isLoading)]
  const label = isLoading || !status ? "Checking…" : !status.configured ? "Not configured" : status.reachable ? "Active" : "Not reachable"
  return { variant, label, className }
}

// InstanceStatusBadge shows whether the configured Stable Diffusion WebUI
// instance is actually reachable right now — separate from the
// enabled/disabled setting itself, which only says "the user wants this
// on," not "it's currently working."
function InstanceStatusBadge({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false)
  const { data: status, isLoading } = useThumbnailEnhancementStatus(enabled)
  const { variant, label, className } = statusBadgeProps(status, isLoading)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Badge
          variant={variant}
          className={cn("cursor-default", className)}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {label}
        </Badge>
      </PopoverTrigger>
      <PopoverContent
        className="text-xs text-muted-foreground"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {!status?.configured
          ? "No Stable Diffusion WebUI URL is saved in Settings → AI Enhancement yet."
          : status.reachable
            ? "The configured Stable Diffusion WebUI instance responded successfully."
            : (status.error ?? "The configured instance couldn't be reached.")}
      </PopoverContent>
    </Popover>
  )
}

const STATUS_ALL = "all"
const TRIGGER_ALL = "all"

export function ThumbnailEnhancementPage() {
  const { data: settings } = useSettings()
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState(STATUS_ALL)
  const [trigger, setTrigger] = useState(TRIGGER_ALL)
  const [page, setPage] = useState(1)

  // Debounce free-text search the same way LibraryToolbar does — filtering
  // on every keystroke re-fetches the whole page each time.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) {
        setSearch(searchInput)
        setPage(1)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, search])

  const { data: historyResult, isLoading } = useThumbnailEnhancementHistory({
    q: search || undefined,
    status: status === STATUS_ALL ? undefined : status,
    trigger: trigger === TRIGGER_ALL ? undefined : trigger,
    page,
  })
  const history = historyResult?.entries
  const total = historyResult?.total ?? 0
  const pageSize = 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const activeItem = useThumbnailEnhancementActiveItem()

  const runNow = useRunThumbnailEnhancementNow()
  const bulkDelete = useBulkDeleteThumbnailEnhancementHistoryEntries()
  const keepEnhanced = useBulkDeleteThumbnailOriginals()
  const keepOriginal = useBulkRevertThumbnailOriginals()
  const redownloadFromOriginal = useRedownloadThumbnailsFromOriginal()
  const [eligibleOpen, setEligibleOpen] = useState(false)
  const [compareEntry, setCompareEntry] = useState<ThumbnailEnhancementHistoryEntry | null>(null)
  const { selected, isSelected, toggle, clear, selectAll, selectOnly, size, active } = useIdSelection()
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [keepEnhancedOpen, setKeepEnhancedOpen] = useState(false)
  const [keepOriginalOpen, setKeepOriginalOpen] = useState(false)
  const [redownloadOpen, setRedownloadOpen] = useState(false)

  // Drag-to-select: mousedown on a row starts the drag and anchors the
  // range; mouseenter on subsequent rows while the button is held extends
  // the selection to every row between the anchor and the row under the
  // cursor. A window-level mouseup ends the drag even if the button is
  // released outside the table.
  const [isDragging, setIsDragging] = useState(false)
  const dragAnchorIdRef = useRef<number | null>(null)

  // Radix's ContextMenu only computes the floating menu's position when its
  // content actually (re)mounts — keying ContextMenuContent on this counter
  // forces a genuine remount (and fresh position read) on every right-click.
  const [contextMenuAnchorKey, setContextMenuAnchorKey] = useState(0)

  // The selection is scoped to what's currently visible — a stale id from a
  // previous page/filter/search shouldn't silently ride along once the
  // underlying rows it referred to are no longer on screen.
  useEffect(() => {
    clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, status, trigger])

  useEffect(() => {
    if (!isDragging) return
    const onMouseUp = () => setIsDragging(false)
    window.addEventListener("mouseup", onMouseUp)
    return () => window.removeEventListener("mouseup", onMouseUp)
  }, [isDragging])

  const isInteractiveTarget = (e: React.MouseEvent) =>
    (e.target as HTMLElement).closest('[role="checkbox"], button, a') != null

  const rangeIds = (anchorId: number, targetId: number) => {
    const rows = history ?? []
    const anchorIdx = rows.findIndex((r) => r.id === anchorId)
    const targetIdx = rows.findIndex((r) => r.id === targetId)
    if (anchorIdx === -1 || targetIdx === -1) return null
    const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    return rows.slice(start, end + 1).map((r) => r.id)
  }

  // Plain click (no drag) selects only this row, deselecting everything
  // else. Ctrl/Cmd+click toggles just this row in or out of the current
  // selection, and Shift+click selects the range from the last-clicked row
  // to this one. The checkbox, the row's title link, and the Compare button
  // are the exceptions — they keep their own click behavior.
  const handleRowMouseDown = (e: React.MouseEvent, id: number) => {
    if (e.button !== 0 || isInteractiveTarget(e)) return
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

  const allSelected = !!history && history.length > 0 && size === history.length
  const someSelected = size > 0 && !allSelected

  // Keep Enhanced/Keep Original only ever act on items that still have a
  // stored original backup (hasOriginalBackup) — same signal the Compare
  // button and the delete-warning already gate on. Redownload has no such
  // restriction client-side; the backend silently skips any item with no
  // saved source URL (see useRedownloadThumbnailsFromOriginal). Both lists
  // dedupe library item ids, since multiple history rows can reference the
  // same item.
  const selectedEntries = (history ?? []).filter((e) => selected.has(e.id))
  const keepEligibleItemIds = Array.from(
    new Set(
      selectedEntries.filter((e) => e.hasOriginalBackup && e.libraryItemId != null).map((e) => e.libraryItemId as number),
    ),
  )
  const redownloadItemIds = Array.from(
    new Set(selectedEntries.filter((e) => e.libraryItemId != null).map((e) => e.libraryItemId as number)),
  )

  const enabled = settings?.thumbnailEnhancementEnabled ?? false

  if (settings && !enabled) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">AI Enhancement</h1>
        <p className="text-sm text-muted-foreground">
          This feature is disabled. Enable it in{" "}
          <Link to="/settings" className="underline underline-offset-2 hover:text-foreground">
            Settings → AI Enhancement
          </Link>{" "}
          to run it.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">AI Enhancement</h1>
            {settings && <InstanceStatusBadge enabled={enabled} />}
          </div>
          <p className="text-sm text-muted-foreground">
            Upscales low-resolution library thumbnails via your configured Stable Diffusion WebUI
            instance. Configure this in Settings → AI Enhancement.
          </p>
          {activeItem.data && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Enhancing: {activeItem.data.itemTitle}
            </p>
          )}
        </div>
      </div>

      <EligibleItemsDialog open={eligibleOpen} onOpenChange={setEligibleOpen} />

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => runNow.mutate()} disabled={!enabled || runNow.isPending}>
          {runNow.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4" />
          )}
          {runNow.isPending ? "Enhancing…" : "Enhance Now"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setEligibleOpen(true)} disabled={!enabled}>
          <ListChecks className="h-4 w-4" />
          Preview Eligible Items
        </Button>

        <Button
          variant="destructive"
          size="sm"
          disabled={!active}
          onClick={() => setConfirmDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" disabled={!active} aria-label="More actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem disabled={keepEligibleItemIds.length === 0} onClick={() => setKeepEnhancedOpen(true)}>
              <Check className="h-4 w-4" />
              Keep enhanced{keepEligibleItemIds.length > 1 ? ` (${keepEligibleItemIds.length})` : ""}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={keepEligibleItemIds.length === 0} onClick={() => setKeepOriginalOpen(true)}>
              <Undo2 className="h-4 w-4" />
              Keep original{keepEligibleItemIds.length > 1 ? ` (${keepEligibleItemIds.length})` : ""}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={redownloadItemIds.length === 0} onClick={() => setRedownloadOpen(true)}>
              <Download className="h-4 w-4" />
              Redownload original{redownloadItemIds.length > 1 ? ` (${redownloadItemIds.length})` : ""}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {active && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        )}

        <div className="ml-auto flex flex-nowrap items-center gap-2">
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-32 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={STATUS_ALL}>All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={trigger}
            onValueChange={(v) => {
              setTrigger(v)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-28 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TRIGGER_ALL}>All triggers</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="auto">Auto</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Search by item title…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="min-w-[160px] max-w-[280px] flex-1 sm:min-w-[200px]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !history || history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {search || status !== STATUS_ALL || trigger !== TRIGGER_ALL
              ? "No history entries match these filters."
              : "Nothing enhanced yet."}
          </p>
        ) : (
          <ContextMenu>
            <ContextMenuTrigger asChild onContextMenu={handleTableContextMenu}>
              {/* Single scroll container (both axes) via containerClassName — layering
                  a second overflow-y-auto wrapper around Table's own overflow-x-auto
                  one would silently break the header's sticky positioning (see
                  Table's doc comment in components/ui/table.tsx). */}
              <Table containerClassName="h-full overflow-auto rounded-md border">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        onCheckedChange={(checked) => (checked ? selectAll(history.map((e) => e.id)) : clear())}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Dimensions</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((entry) => (
                    <TableRow
                      key={entry.id}
                      data-history-id={entry.id}
                      data-state={isSelected(entry.id) ? "selected" : undefined}
                      className="cursor-default select-none"
                      onMouseDown={(e) => handleRowMouseDown(e, entry.id)}
                      onMouseEnter={() => handleRowMouseEnter(entry.id)}
                    >
                      <TableCell>
                        <Checkbox
                          checked={isSelected(entry.id)}
                          onCheckedChange={() => toggle(entry.id)}
                          aria-label={`Select ${entry.itemTitle}`}
                        />
                      </TableCell>
                      <TableCell>
                        <ItemTitleCell entry={entry} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {entry.revertedAt ? (
                            <RevertedBadge revertedAt={entry.revertedAt} />
                          ) : (
                            <>
                              <Badge variant={entry.status === "success" ? "default" : "destructive"}>
                                {entry.status === "success" ? "Success" : "Failed"}
                              </Badge>
                              {entry.status === "failed" && entry.error && <ErrorBadge error={entry.error} />}
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {entry.triggerType === "manual" ? "Manual" : entry.triggerType === "scheduled" ? "Scheduled" : "Auto"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {dimensions(entry.originalWidth, entry.originalHeight)} → {dimensions(entry.enhancedWidth, entry.enhancedHeight)}
                      </TableCell>
                      <TableCell>
                        {entry.originalSizeBytes != null ? formatBytes(entry.originalSizeBytes) : "—"} →{" "}
                        {entry.enhancedSizeBytes != null ? formatBytes(entry.enhancedSizeBytes) : "—"}
                      </TableCell>
                      <TableCell>{new Date(entry.createdAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          {entry.hasOriginalBackup && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={() => setCompareEntry(entry)}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Compare</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ContextMenuTrigger>
            <ContextMenuContent key={contextMenuAnchorKey}>
              <ContextMenuItem variant="destructive" disabled={!active} onClick={() => setConfirmDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" />
                Delete{size > 1 ? ` (${size})` : ""}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
      </div>

      {!isLoading && history && history.length > 0 && (
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

      {compareEntry && (
        <CompareThumbnailDialog
          open={compareEntry != null}
          onOpenChange={(open) => !open && setCompareEntry(null)}
          entry={compareEntry}
        />
      )}

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {size} history {size === 1 ? "entry" : "entries"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectionHasBackup(history, selected)
                ? "One or more selected items still have a stored original. If a deleted entry is the last one referencing its item, deleting it also frees that original — Compare and Revert won't be available for that item until it's enhanced again."
                : "Removes the selected rows from the list. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                bulkDelete.mutate(Array.from(selected), { onSuccess: () => clear() })
                setConfirmDeleteOpen(false)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={keepEnhancedOpen} onOpenChange={setKeepEnhancedOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Keep enhanced thumbnail for {keepEligibleItemIds.length}{" "}
              {keepEligibleItemIds.length === 1 ? "item" : "items"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Permanently commits to the enhanced thumbnail for each item and frees its stored
              original. Compare and Revert won't be available for these items until they're
              enhanced again. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                keepEnhanced.mutate(keepEligibleItemIds, { onSuccess: () => clear() })
                setKeepEnhancedOpen(false)
              }}
            >
              Keep Enhanced
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={keepOriginalOpen} onOpenChange={setKeepOriginalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore original thumbnail for {keepEligibleItemIds.length}{" "}
              {keepEligibleItemIds.length === 1 ? "item" : "items"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Restores each item's pre-enhancement thumbnail and discards the enhanced version.
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                keepOriginal.mutate(keepEligibleItemIds, { onSuccess: () => clear() })
                setKeepOriginalOpen(false)
              }}
            >
              Keep Original
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={redownloadOpen} onOpenChange={setRedownloadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Redownload thumbnail from original for {redownloadItemIds.length}{" "}
              {redownloadItemIds.length === 1 ? "item" : "items"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Re-fetches each item's thumbnail from its saved source URL, replacing the current
              one (enhanced or original). Items in the selection with no saved source URL are
              skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                redownloadFromOriginal.mutate(redownloadItemIds, { onSuccess: () => clear() })
                setRedownloadOpen(false)
              }}
            >
              Redownload
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// selectionHasBackup reports whether any currently-selected row's item still
// has a stored original — with server-side pagination, the currently-loaded
// page isn't guaranteed to contain every row for a given item, so this reads
// hasOriginalBackup directly off each selected row rather than counting.
function selectionHasBackup(
  history: ThumbnailEnhancementHistoryEntry[] | undefined,
  selectedIds: Set<number>,
): boolean {
  if (!history) return false
  return history.some((e) => selectedIds.has(e.id) && e.hasOriginalBackup)
}

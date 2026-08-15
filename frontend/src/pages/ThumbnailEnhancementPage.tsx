import { useEffect, useState } from "react"
import { AlertTriangle, Eye, Loader2, Trash2 } from "lucide-react"
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
  useThumbnailEnhancementActiveItem,
  useThumbnailEnhancementHistory,
  useThumbnailEnhancementStatus,
  useRunThumbnailEnhancementNow,
} from "@/hooks/useThumbnailEnhancement"
import { useSettings } from "@/hooks/useSettings"
import { getPageNumbers } from "@/lib/pagination"
import { formatBytes } from "@/lib/utils"
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

function statusBadgeProps(status: ThumbnailEnhancementStatus | undefined, isLoading: boolean) {
  if (isLoading || !status) return { variant: "secondary" as const, label: "Checking…" }
  if (!status.configured) return { variant: "secondary" as const, label: "Not configured" }
  if (status.reachable) return { variant: "default" as const, label: "Active" }
  return { variant: "destructive" as const, label: "Not reachable" }
}

// InstanceStatusBadge shows whether the configured Stable Diffusion WebUI
// instance is actually reachable right now — separate from the
// enabled/disabled setting itself, which only says "the user wants this
// on," not "it's currently working."
function InstanceStatusBadge({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false)
  const { data: status, isLoading } = useThumbnailEnhancementStatus(enabled)
  const { variant, label } = statusBadgeProps(status, isLoading)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Badge variant={variant} className="cursor-default" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
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
  const [eligibleOpen, setEligibleOpen] = useState(false)
  const [compareEntry, setCompareEntry] = useState<ThumbnailEnhancementHistoryEntry | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  // The selection is scoped to what's currently visible — a stale id from a
  // previous page/filter/search shouldn't silently ride along once the
  // underlying rows it referred to are no longer on screen.
  useEffect(() => {
    setSelectedIds(new Set())
  }, [page, search, status, trigger])

  const toggleOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set((history ?? []).map((e) => e.id)) : new Set())
  }

  const allSelected = !!history && history.length > 0 && selectedIds.size === history.length
  const someSelected = selectedIds.size > 0 && !allSelected

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
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => setEligibleOpen(true)} disabled={!enabled}>
            Preview Eligible Items
          </Button>
          <Button onClick={() => runNow.mutate()} disabled={!enabled || runNow.isPending}>
            {runNow.isPending ? "Enhancing…" : "Enhance Now"}
          </Button>
        </div>
      </div>

      <EligibleItemsDialog open={eligibleOpen} onOpenChange={setEligibleOpen} />

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="destructive"
            size="sm"
            disabled={selectedIds.size === 0}
            onClick={() => setConfirmDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            Delete Selected
          </Button>
          {selectedIds.size > 0 && (
            <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
          )}
        </div>
        <div className="flex flex-nowrap items-center gap-2">
          <Input
            placeholder="Search by item title…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-40 shrink"
          />
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-28 shrink-0">
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
          // Single scroll container (both axes) via containerClassName — layering
          // a second overflow-y-auto wrapper around Table's own overflow-x-auto
          // one would silently break the header's sticky positioning (see
          // Table's doc comment in components/ui/table.tsx).
          <Table containerClassName="h-full overflow-auto rounded-md border">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={(checked) => toggleAll(checked === true)}
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
                <TableRow key={entry.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(entry.id)}
                      onCheckedChange={(checked) => toggleOne(entry.id, checked === true)}
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
              Delete {selectedIds.size} history {selectedIds.size === 1 ? "entry" : "entries"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectionHasBackup(history, selectedIds)
                ? "One or more selected items still have a stored original. If a deleted entry is the last one referencing its item, deleting it also frees that original — Compare and Revert won't be available for that item until it's enhanced again."
                : "Removes the selected rows from the list. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                bulkDelete.mutate(Array.from(selectedIds), { onSuccess: () => setSelectedIds(new Set()) })
                setConfirmDeleteOpen(false)
              }}
            >
              Delete
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

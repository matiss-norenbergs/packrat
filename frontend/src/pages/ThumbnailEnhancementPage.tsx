import { useEffect, useMemo, useState } from "react"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DataTable } from "@/components/data-table"
import type { ColumnDef } from "@/components/data-table"
import { RevealAllFloatingAction } from "@/components/library/RevealAllFloatingAction"
import { useRevealAll } from "@/components/library/RevealAllContext"
import { useLibraryItem } from "@/hooks/useLibrary"
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
import { cn, formatBytes, hashText } from "@/lib/utils"
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

// Titles of private items are hashed unless reveal-all is on (the floating
// button is the only way to reveal them on this page; no per-row click).
function entryTitle(entry: ThumbnailEnhancementHistoryEntry, revealAll: boolean): string {
  return entry.blurred && !revealAll ? hashText(entry.itemTitle) : entry.itemTitle
}

function ItemTitleCell({ entry }: { entry: ThumbnailEnhancementHistoryEntry }) {
  const { revealAll } = useRevealAll()
  if (entry.blurred && !revealAll) return <span>{hashText(entry.itemTitle)}</span>
  if (entry.libraryItemId == null) return <span>{entry.itemTitle}</span>
  return (
    <Link to={`/library/${entry.libraryItemId}`} className="underline underline-offset-2 hover:text-foreground">
      {entry.itemTitle}
    </Link>
  )
}

// The live "Enhancing:" line. The enhance_progress event carries no privacy
// flag, so it is looked up via the single-item fetch; until that answers (or
// if it fails) the title stays hashed.
function ActiveItemLine({ libraryItemId, itemTitle }: { libraryItemId: number; itemTitle: string }) {
  const { revealAll } = useRevealAll()
  const item = useLibraryItem(libraryItemId)
  const hidden = !revealAll && (item.isError || !item.data || item.data.blurred)
  return (
    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Enhancing: {hidden ? hashText(itemTitle) : itemTitle}
    </p>
  )
}

// Green/red/grey mirrors the sidebar nav dot — both read the same
// enhancementStatusColor helper so the page and the nav always agree on
// what "active/not reachable/not configured" means.
const STATUS_BADGE_STYLE: Record<EnhancementStatusColor, { variant: "success" | "destructive" | "secondary"; className: string }> = {
  green: { variant: "success", className: "" },
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
const MODE_ALL = "all"

export function ThumbnailEnhancementPage() {
  const { data: settings } = useSettings()
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState(STATUS_ALL)
  const [trigger, setTrigger] = useState(TRIGGER_ALL)
  const [mode, setMode] = useState(MODE_ALL)
  const [page, setPage] = useState(1)

  const { data: historyResult, isLoading } = useThumbnailEnhancementHistory({
    q: search || undefined,
    status: status === STATUS_ALL ? undefined : status,
    trigger: trigger === TRIGGER_ALL ? undefined : trigger,
    mode: mode === MODE_ALL ? undefined : mode,
    page,
  })
  const history = historyResult?.entries
  const total = historyResult?.total ?? 0
  const pageSize = 25
  const activeItem = useThumbnailEnhancementActiveItem()
  const { revealAll } = useRevealAll()

  const runNow = useRunThumbnailEnhancementNow()
  const bulkDelete = useBulkDeleteThumbnailEnhancementHistoryEntries()
  const keepEnhanced = useBulkDeleteThumbnailOriginals()
  const keepOriginal = useBulkRevertThumbnailOriginals()
  const redownloadFromOriginal = useRedownloadThumbnailsFromOriginal()
  const [eligibleOpen, setEligibleOpen] = useState(false)
  const [compareEntry, setCompareEntry] = useState<ThumbnailEnhancementHistoryEntry | null>(null)
  const selection = useIdSelection()
  const { selected, clear, size, active } = selection
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [keepEnhancedOpen, setKeepEnhancedOpen] = useState(false)
  const [keepOriginalOpen, setKeepOriginalOpen] = useState(false)
  const [redownloadOpen, setRedownloadOpen] = useState(false)

  // The selection is scoped to what's currently visible — a stale id from a
  // previous page/filter/search shouldn't silently ride along once the
  // underlying rows it referred to are no longer on screen.
  useEffect(() => {
    clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, status, trigger, mode])

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

  // Cells close over nothing that changes: ItemTitleCell reads reveal-all itself, and setCompareEntry is a
  // state setter (stable), so the columns are built once.
  const columns = useMemo<ColumnDef<ThumbnailEnhancementHistoryEntry>[]>(
    () => [
      { key: "item", header: "Item", flex: true, cell: (e) => <ItemTitleCell entry={e} /> },
      {
        key: "status",
        header: "Status",
        type: "status",
        width: 160,
        cell: (e) => (
          <div className="flex items-center justify-center gap-1.5">
            {e.revertedAt ? (
              <RevertedBadge revertedAt={e.revertedAt} />
            ) : (
              <>
                <Badge variant={e.status === "success" ? "success" : "destructive"}>
                  {e.status === "success" ? "Success" : "Failed"}
                </Badge>
                {e.status === "failed" && e.error && <ErrorBadge error={e.error} />}
              </>
            )}
          </div>
        ),
      },
      {
        key: "trigger",
        header: "Trigger",
        type: "status",
        cell: (e) => (
          <Badge variant="secondary">
            {e.triggerType === "manual" ? "Manual" : e.triggerType === "scheduled" ? "Scheduled" : "Auto"}
          </Badge>
        ),
      },
      {
        key: "mode",
        header: "Type",
        type: "status",
        cell: (e) => <Badge variant="outline">{e.mode === "sharpen" ? "Sharpen" : "Upscale"}</Badge>,
      },
      {
        key: "dimensions",
        header: "Dimensions",
        type: "number",
        width: 190,
        cell: (e) =>
          `${dimensions(e.originalWidth, e.originalHeight)} → ${dimensions(e.enhancedWidth, e.enhancedHeight)}`,
      },
      {
        key: "size",
        header: "Size",
        type: "number",
        width: 160,
        cell: (e) =>
          `${e.originalSizeBytes != null ? formatBytes(e.originalSizeBytes) : "—"} → ${e.enhancedSizeBytes != null ? formatBytes(e.enhancedSizeBytes) : "—"}`,
      },
      { key: "date", header: "Date", type: "date", cell: (e) => new Date(e.createdAt).toLocaleString() },
      {
        key: "actions",
        header: "Actions",
        type: "icon",
        width: 80,
        cell: (e) =>
          e.hasOriginalBackup && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => setCompareEntry(e)}>
                  <Eye className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Compare</TooltipContent>
            </Tooltip>
          ),
      },
    ],
    [],
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
      <RevealAllFloatingAction />
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
            <ActiveItemLine libraryItemId={activeItem.data.libraryItemId} itemTitle={activeItem.data.itemTitle} />
          )}
        </div>
      </div>

      <EligibleItemsDialog open={eligibleOpen} onOpenChange={setEligibleOpen} />

      <DataTable
        rows={history ?? []}
        getRowId={(e) => e.id}
        columns={columns}
        tableId="ai-enhancement"
        selection="multi"
        selectionState={selection}
        getRowLabel={(e) => `Select ${entryTitle(e, revealAll)}`}
        loading={isLoading}
        empty={
          <p className="text-sm text-muted-foreground">
            {search || status !== STATUS_ALL || trigger !== TRIGGER_ALL || mode !== MODE_ALL
              ? "No history entries match these filters."
              : "Nothing enhanced yet."}
          </p>
        }
        search={{
          placeholder: "Search by item title…",
          onChange: (q) => {
            setSearch(q)
            setPage(1)
          },
        }}
        pagination={{ page, pageSize, total, onPageChange: setPage, itemLabel: { singular: "entry", plural: "entries" } }}
        contextMenu={() => [
          {
            key: "delete",
            label: `Delete${size > 1 ? ` (${size})` : ""}`,
            icon: <Trash2 className="h-4 w-4" />,
            destructive: true,
            disabled: !active,
            onSelect: () => setConfirmDeleteOpen(true),
          },
        ]}
        toolbar={
          <>
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
          </>
        }
        filters={
          <>
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
            <Select
              value={mode}
              onValueChange={(v) => {
                setMode(v)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-32 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MODE_ALL}>All types</SelectItem>
                <SelectItem value="upscale">Upscale</SelectItem>
                <SelectItem value="sharpen">Sharpen</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />

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

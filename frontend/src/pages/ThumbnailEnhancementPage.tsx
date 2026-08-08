import { useState } from "react"
import { AlertTriangle, Eye, Trash2 } from "lucide-react"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { EligibleItemsDialog } from "@/components/thumbnailenhance/EligibleItemsDialog"
import { CompareThumbnailDialog } from "@/components/thumbnailenhance/CompareThumbnailDialog"
import {
  useDeleteThumbnailEnhancementHistoryEntry,
  useThumbnailEnhancementHistory,
  useThumbnailEnhancementStatus,
  useRunThumbnailEnhancementNow,
} from "@/hooks/useThumbnailEnhancement"
import { useSettings } from "@/hooks/useSettings"
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

export function ThumbnailEnhancementPage() {
  const { data: settings } = useSettings()
  const { data: history, isLoading } = useThumbnailEnhancementHistory()
  const runNow = useRunThumbnailEnhancementNow()
  const deleteEntry = useDeleteThumbnailEnhancementHistoryEntry()
  const [eligibleOpen, setEligibleOpen] = useState(false)
  const [compareEntry, setCompareEntry] = useState<ThumbnailEnhancementHistoryEntry | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">AI Enhancement</h1>
            {settings && <InstanceStatusBadge enabled={enabled} />}
          </div>
          <p className="text-sm text-muted-foreground">
            Upscales low-resolution library thumbnails via your configured Stable Diffusion WebUI
            instance. Configure this in Settings → AI Enhancement.
          </p>
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

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !history || history.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing enhanced yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
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
                  <ItemTitleCell entry={entry} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={entry.status === "success" ? "default" : "destructive"}>
                      {entry.status === "success" ? "Success" : "Failed"}
                    </Badge>
                    {entry.status === "failed" && entry.error && <ErrorBadge error={entry.error} />}
                    {entry.revertedAt && <RevertedBadge revertedAt={entry.revertedAt} />}
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(entry.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {compareEntry && (
        <CompareThumbnailDialog
          open={compareEntry != null}
          onOpenChange={(open) => !open && setCompareEntry(null)}
          entry={compareEntry}
        />
      )}

      <AlertDialog open={deleteId != null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this history entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {isLastRowWithBackup(history, deleteId)
                ? "This is the last history entry for this item, and it still has a stored original. Deleting it also frees that original — Compare and Revert won't be available for this item until it's enhanced again."
                : "Removes this row from the list. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId != null) deleteEntry.mutate(deleteId)
                setDeleteId(null)
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

// isLastRowWithBackup mirrors the backend's DeleteHistoryEntry cascade
// check — true when the entry being deleted is the only history row left
// for its item and that item still has a backed-up original, so the
// confirmation dialog can warn the backup is about to be freed too.
function isLastRowWithBackup(
  history: ThumbnailEnhancementHistoryEntry[] | undefined,
  deleteId: number | null,
): boolean {
  if (!history || deleteId == null) return false
  const entry = history.find((e) => e.id === deleteId)
  if (!entry || !entry.hasOriginalBackup || entry.libraryItemId == null) return false
  return history.filter((e) => e.libraryItemId === entry.libraryItemId).length === 1
}

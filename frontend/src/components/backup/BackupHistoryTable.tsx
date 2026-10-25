import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Download, Eye, Play, RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"
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
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  backupHistoryQueryKey,
  useBackupHistory,
  useDeleteBackupHistoryEntry,
  useRestoreFullBackup,
  useRunManualBackup,
} from "@/hooks/useBackup"
import { useIdSelection } from "@/hooks/useIdSelection"
import { backupDownloadUrl } from "@/lib/api"
import { formatBytes } from "@/lib/utils"
import type { BackupHistoryEntry, LibraryImportMode } from "@/types/api"
import { BackupContentPreviewDialog } from "./BackupContentPreviewDialog"

function itemsSummary(entry: BackupHistoryEntry): string {
  if (entry.status !== "success") return "—"
  const parts = [
    `${entry.libraryItemsCount ?? 0} items`,
    `${entry.collectionsCount ?? 0} collections`,
    `${entry.tagsCount ?? 0} tags`,
    `${entry.artistsCount ?? 0} artists`,
  ]
  return parts.join(" · ")
}

const hasFile = (entry: BackupHistoryEntry) => entry.status === "success" && Boolean(entry.fileName)

// Clicks a transient <a download>, the same thing a visible download link does — the desktop shell's
// link handler skips anchors with a `download` attribute and its download callback (download folder /
// Save dialog) takes over, so this behaves exactly like the old per-row link.
function startDownload(id: number) {
  const a = document.createElement("a")
  a.href = backupDownloadUrl(id)
  a.download = ""
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function BackupHistoryTable() {
  const { data, isLoading } = useBackupHistory()
  const queryClient = useQueryClient()
  const runBackup = useRunManualBackup()
  const deleteEntry = useDeleteBackupHistoryEntry({ silent: true })
  const restoreEntry = useRestoreFullBackup()
  const { selected, isSelected, toggle, clear, selectAll, selectOnly } = useIdSelection()
  // Dialog targets live in their own state (not read from the selection) so changing the selection
  // while a dialog is open can't change what gets previewed, restored or deleted.
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [deleteIds, setDeleteIds] = useState<number[]>([])
  const [restoreId, setRestoreId] = useState<number | null>(null)
  const [restoreMode, setRestoreMode] = useState<LibraryImportMode>("download")

  const [isDragging, setIsDragging] = useState(false)
  const dragAnchorIdRef = useRef<number | null>(null)
  // Radix's ContextMenu only positions its content when it (re)mounts — see LogsPage.
  const [contextMenuAnchorKey, setContextMenuAnchorKey] = useState(0)

  const rows = data ?? []

  useEffect(() => {
    if (!isDragging) return
    const onMouseUp = () => setIsDragging(false)
    window.addEventListener("mouseup", onMouseUp)
    return () => window.removeEventListener("mouseup", onMouseUp)
  }, [isDragging])

  // Rows can vanish (delete, retention sweep, another tab): drop their ids from the selection.
  useEffect(() => {
    if (!data) return
    const existing = new Set(data.map((entry) => entry.id))
    const kept = [...selected].filter((id) => existing.has(id))
    if (kept.length !== selected.size) selectAll(kept)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const selectedRows = rows.filter((entry) => selected.has(entry.id))
  const size = selectedRows.length
  const singleEntry = size === 1 ? selectedRows[0] : null
  const singleHasFile = singleEntry != null && hasFile(singleEntry)
  const fileActionReason =
    size === 0
      ? "Select a backup"
      : size > 1
        ? "Select a single backup"
        : !singleHasFile
          ? "This backup failed, so there is no file"
          : null
  const deleteReason = size === 0 ? "Select one or more backups" : null

  const allSelected = rows.length > 0 && rows.every((entry) => selected.has(entry.id))
  const someSelected = size > 0 && !allSelected

  const isCheckboxTarget = (e: React.MouseEvent) => (e.target as HTMLElement).closest('[role="checkbox"]') != null

  const rangeIds = (anchorId: number, targetId: number) => {
    const anchorIdx = rows.findIndex((entry) => entry.id === anchorId)
    const targetIdx = rows.findIndex((entry) => entry.id === targetId)
    if (anchorIdx === -1 || targetIdx === -1) return null
    const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    return rows.slice(start, end + 1).map((entry) => entry.id)
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
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>("tr[data-backup-id]")
    if (!rowEl) {
      e.preventDefault()
      return
    }
    const id = Number(rowEl.dataset.backupId)
    if (!selected.has(id)) selectOnly(id)
    setContextMenuAnchorKey((k) => k + 1)
  }

  const confirmDelete = async () => {
    const ids = deleteIds
    setDeleteIds([])
    if (ids.length === 0) return
    const results = await Promise.allSettled(ids.map((id) => deleteEntry.mutateAsync(id)))
    const failed = results.filter((r) => r.status === "rejected")
    const ok = ids.length - failed.length
    if (failed.length === 0) {
      toast.success(ids.length === 1 ? "Backup deleted" : `Deleted ${ok} backups`)
    } else if (ok === 0) {
      toast.error(
        ids.length === 1
          ? `Delete failed: ${(failed[0] as PromiseRejectedResult).reason?.message ?? "unknown error"}`
          : `Delete failed for ${ids.length} backups`,
      )
    } else {
      toast.error(`Deleted ${ok}, ${failed.length} failed`)
    }
    clear()
    await queryClient.invalidateQueries({ queryKey: backupHistoryQueryKey })
  }

  const deleteLabel = size > 1 ? `Delete ${size}` : "Delete"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => runBackup.mutate()} disabled={runBackup.isPending}>
          <Play />
          {runBackup.isPending ? "Running…" : "Run Backup Now"}
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={fileActionReason != null}
              onClick={() => singleEntry && setPreviewId(singleEntry.id)}
            >
              <Eye />
              Preview
            </Button>
          </TooltipTrigger>
          <TooltipContent>{fileActionReason ?? "Preview this backup's contents"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={fileActionReason != null}
              onClick={() => singleEntry && startDownload(singleEntry.id)}
            >
              <Download />
              Download
            </Button>
          </TooltipTrigger>
          <TooltipContent>{fileActionReason ?? "Download this backup"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={fileActionReason != null}
              onClick={() => singleEntry && setRestoreId(singleEntry.id)}
            >
              <RotateCcw />
              Restore
            </Button>
          </TooltipTrigger>
          <TooltipContent>{fileActionReason ?? "Restore this backup"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={deleteReason != null}
              onClick={() => setDeleteIds(selectedRows.map((entry) => entry.id))}
            >
              <Trash2 />
              {deleteLabel}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{deleteReason ?? (size > 1 ? `Delete ${size} backups` : "Delete this backup")}</TooltipContent>
        </Tooltip>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No backups yet.</p>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild onContextMenu={handleTableContextMenu}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-center">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={(checked) => (checked ? selectAll(rows.map((entry) => entry.id)) : clear())}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead className="text-center">Date</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead>Contents</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((entry) => (
                  <TableRow
                    key={entry.id}
                    data-backup-id={entry.id}
                    data-state={isSelected(entry.id) ? "selected" : undefined}
                    className="cursor-default select-none"
                    onMouseDown={(e) => handleRowMouseDown(e, entry.id)}
                    onMouseEnter={() => handleRowMouseEnter(entry.id)}
                  >
                    <TableCell className="text-center">
                      <Checkbox
                        checked={isSelected(entry.id)}
                        onCheckedChange={() => toggle(entry.id)}
                        aria-label={`Select backup from ${new Date(entry.createdAt).toLocaleString()}`}
                      />
                    </TableCell>
                    <TableCell className="text-center">{new Date(entry.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{entry.triggerType === "manual" ? "Manual" : "Scheduled"}</TableCell>
                    <TableCell className="text-center">
                      <div className="space-y-1">
                        <Badge variant={entry.status === "success" ? "success" : "destructive"}>
                          {entry.status === "success" ? "Success" : "Failed"}
                        </Badge>
                        {entry.status === "failed" && entry.errorMessage && (
                          <p className="max-w-64 truncate text-xs text-destructive" title={entry.errorMessage}>
                            {entry.errorMessage}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{itemsSummary(entry)}</TableCell>
                    <TableCell className="text-right">
                      {entry.fileSizeBytes != null ? formatBytes(entry.fileSizeBytes) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ContextMenuTrigger>
          <ContextMenuContent key={contextMenuAnchorKey}>
            {singleEntry && singleHasFile && (
              <>
                <ContextMenuItem onClick={() => setPreviewId(singleEntry.id)}>
                  <Eye /> Preview
                </ContextMenuItem>
                <ContextMenuItem onClick={() => startDownload(singleEntry.id)}>
                  <Download /> Download
                </ContextMenuItem>
                <ContextMenuItem onClick={() => setRestoreId(singleEntry.id)}>
                  <RotateCcw /> Restore
                </ContextMenuItem>
              </>
            )}
            <ContextMenuItem
              disabled={size === 0}
              onClick={() => setDeleteIds(selectedRows.map((entry) => entry.id))}
            >
              <Trash2 /> {size > 1 ? `Delete ${size} backups` : "Delete"}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}

      <BackupContentPreviewDialog
        open={previewId != null}
        onOpenChange={(open) => !open && setPreviewId(null)}
        backupId={previewId}
      />

      <AlertDialog open={deleteIds.length > 0} onOpenChange={(open) => !open && setDeleteIds([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteIds.length > 1 ? `Delete ${deleteIds.length} backups?` : "Delete this backup?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteIds.length > 1
                ? "Permanently deletes these backups' files and their entries in this list. This can't be undone."
                : "Permanently deletes this backup's file and its entry in this list. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={restoreId != null} onOpenChange={(open) => !open && setRestoreId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Applies both halves of this backup: settings are overwritten with the backed-up
                  values, and any missing collections, tags, artists, and library items are
                  created. Nothing existing is ever deleted.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="restore-mode">Library items with a saved URL</Label>
                  <Select value={restoreMode} onValueChange={(v) => setRestoreMode(v as LibraryImportMode)}>
                    <SelectTrigger id="restore-mode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="download">Import and download</SelectItem>
                      <SelectItem value="ghostOnly">Import as ghost items</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (restoreId != null) restoreEntry.mutate({ id: restoreId, mode: restoreMode })
                setRestoreId(null)
              }}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

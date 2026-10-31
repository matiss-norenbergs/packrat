import { useEffect, useMemo, useState } from "react"
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
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DataTable } from "@/components/data-table"
import type { ColumnDef } from "@/components/data-table"
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

const columns: ColumnDef<BackupHistoryEntry>[] = [
  { key: "date", header: "Date", type: "date", cell: (entry) => new Date(entry.createdAt).toLocaleString() },
  { key: "trigger", header: "Trigger", cell: (entry) => (entry.triggerType === "manual" ? "Manual" : "Scheduled") },
  {
    key: "status",
    header: "Status",
    type: "status",
    cell: (entry) => (
      <div className="space-y-1">
        <Badge variant={entry.status === "success" ? "success" : "destructive"}>
          {entry.status === "success" ? "Success" : "Failed"}
        </Badge>
        {entry.status === "failed" && entry.errorMessage && (
          <p className="truncate text-xs text-destructive" title={entry.errorMessage}>
            {entry.errorMessage}
          </p>
        )}
      </div>
    ),
  },
  { key: "contents", header: "Contents", cell: itemsSummary },
  { key: "size", header: "Size", type: "number", cell: (entry) => (entry.fileSizeBytes != null ? formatBytes(entry.fileSizeBytes) : "—") },
]

// The table sits in a card on the Backup page rather than filling a page column, so it keeps the plain
// Table look: no border, no fill-the-height container (the default of Table in components/ui/table.tsx).
const CONTAINER_CLASS = "relative w-full overflow-x-auto"

export function BackupHistoryTable() {
  const { data, isLoading } = useBackupHistory()
  const queryClient = useQueryClient()
  const runBackup = useRunManualBackup()
  const deleteEntry = useDeleteBackupHistoryEntry({ silent: true })
  const restoreEntry = useRestoreFullBackup()
  const selection = useIdSelection()
  const { selected, clear, selectAll } = selection
  // Dialog targets live in their own state (not read from the selection) so changing the selection
  // while a dialog is open can't change what gets previewed, restored or deleted.
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [deleteIds, setDeleteIds] = useState<number[]>([])
  const [restoreId, setRestoreId] = useState<number | null>(null)
  const [restoreMode, setRestoreMode] = useState<LibraryImportMode>("download")

  const rows = useMemo(() => data ?? [], [data])

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

  return (
    <>
      <DataTable
        className="gap-4"
        containerClassName={CONTAINER_CLASS}
        rows={rows}
        getRowId={(entry) => entry.id}
        columns={columns}
        selection="multi"
        selectionState={selection}
        getRowLabel={(entry) => `Select backup from ${new Date(entry.createdAt).toLocaleString()}`}
        loading={isLoading}
        empty={<p className="text-sm text-muted-foreground">No backups yet.</p>}
        toolbar={
          <>
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
                  Delete
                </Button>
              </TooltipTrigger>
              <TooltipContent>{deleteReason ?? (size > 1 ? `Delete ${size} backups` : "Delete this backup")}</TooltipContent>
            </Tooltip>
          </>
        }
        contextMenu={(menuRows) => {
          const [only] = menuRows
          const fileItems =
            menuRows.length === 1 && hasFile(only)
              ? [
                  { key: "preview", label: "Preview", icon: <Eye />, onSelect: () => setPreviewId(only.id) },
                  { key: "download", label: "Download", icon: <Download />, onSelect: () => startDownload(only.id) },
                  { key: "restore", label: "Restore", icon: <RotateCcw />, onSelect: () => setRestoreId(only.id) },
                ]
              : []
          return [
            ...fileItems,
            {
              key: "delete",
              label: menuRows.length > 1 ? `Delete (${menuRows.length})` : "Delete",
              icon: <Trash2 />,
              disabled: menuRows.length === 0,
              onSelect: (target: BackupHistoryEntry[]) => setDeleteIds(target.map((entry) => entry.id)),
            },
          ]
        }}
      />

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
    </>
  )
}

import { useState } from "react"
import { Download, Eye, RotateCcw, Trash2 } from "lucide-react"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useBackupHistory, useDeleteBackupHistoryEntry, useRestoreFullBackup, useRunManualBackup } from "@/hooks/useBackup"
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

export function BackupHistoryTable() {
  const { data, isLoading } = useBackupHistory()
  const runBackup = useRunManualBackup()
  const deleteEntry = useDeleteBackupHistoryEntry()
  const restoreEntry = useRestoreFullBackup()
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [restoreId, setRestoreId] = useState<number | null>(null)
  const [restoreMode, setRestoreMode] = useState<LibraryImportMode>("download")

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Every automatic and manual backup that's run, most recent first.
        </p>
        <Button onClick={() => runBackup.mutate()} disabled={runBackup.isPending}>
          {runBackup.isPending ? "Running…" : "Run Backup Now"}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No backups yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-center">Date</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead>Contents</TableHead>
              <TableHead className="text-right">Size</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((entry) => (
              <TableRow key={entry.id}>
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
                <TableCell className="text-right">{entry.fileSizeBytes != null ? formatBytes(entry.fileSizeBytes) : "—"}</TableCell>
                <TableCell>
                  <div className="flex justify-center gap-1">
                    {entry.status === "success" && entry.fileName && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => setPreviewId(entry.id)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Preview</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" asChild>
                              <a href={backupDownloadUrl(entry.id)} download>
                                <Download className="h-4 w-4" />
                              </a>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Download</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => setRestoreId(entry.id)}>
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Restore</TooltipContent>
                        </Tooltip>
                      </>
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

      <BackupContentPreviewDialog
        open={previewId != null}
        onOpenChange={(open) => !open && setPreviewId(null)}
        backupId={previewId}
      />

      <AlertDialog open={deleteId != null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently deletes this backup's file and its entry in this list. This can't be undone.
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

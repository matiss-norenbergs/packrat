import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useBackupPreview } from "@/hooks/useBackup"
import type { BackupPreviewItem } from "@/types/api"

interface BackupContentPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  backupId: number | null
}

// Read-only sibling to LibraryImportPreviewDialog — same summary-line +
// scrollable item-card layout, but nothing here is "new" or "already in
// library" (there's no import happening, just inspection of what's inside
// the file), so there's no diff badges and no commit action, just Close.
export function BackupContentPreviewDialog({ open, onOpenChange, backupId }: BackupContentPreviewDialogProps) {
  const { data: preview, isLoading } = useBackupPreview(backupId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Backup contents</DialogTitle>
          <DialogDescription>What's inside this backup file.</DialogDescription>
        </DialogHeader>

        {isLoading || !preview ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{preview.settingsCount}</span> settings entries
              </span>
              <span>
                <span className="font-medium text-foreground">{preview.collections.length}</span> collections
              </span>
              <span>
                <span className="font-medium text-foreground">{preview.tags.length}</span> tags
              </span>
              <span>
                <span className="font-medium text-foreground">{preview.artists.length}</span> artists
              </span>
              <span>
                <span className="font-medium text-foreground">{preview.items.length}</span> items
              </span>
            </div>

            <div className="max-h-[50vh] space-y-2 overflow-y-auto">
              {preview.items.length === 0 ? (
                <p className="px-1 py-1 text-sm text-muted-foreground">No library items in this backup.</p>
              ) : (
                preview.items.map((item, i) => <PreviewItemRow key={`${item.originalUrl}-${i}`} item={item} />)
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PreviewItemRow({ item }: { item: BackupPreviewItem }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border p-2">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium">{item.title || item.originalUrl}</p>
        {item.originalUrl && <p className="truncate text-xs text-muted-foreground">{item.originalUrl}</p>}
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline">
            {item.collectionPath && item.collectionPath.length > 0 ? item.collectionPath.join(" / ") : "Uncategorized"}
          </Badge>
          {item.artistName && <Badge variant="outline">{item.artistName}</Badge>}
          {item.tags?.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      </div>
      {item.isGhost && (
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant="outline">Ghost</Badge>
        </div>
      )}
    </div>
  )
}

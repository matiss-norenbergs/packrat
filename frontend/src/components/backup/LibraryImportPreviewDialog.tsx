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
import { useImportLibrary } from "@/hooks/useBackup"
import type { LibraryImportPreview, PreviewLibraryItem } from "@/types/api"

interface LibraryImportPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  preview: LibraryImportPreview | null
  data: string
  password: string
  onImported: () => void
}

// Shown after clicking "Preview" on the Backup page's Library import card —
// decrypts/parses the selected file server-side (see backup.PreviewLibraryBundle)
// without writing anything, so the user can see what an import would do
// before committing to it. "Import Now" runs the same mutation the page's
// own Import button does, just without a second confirmation step — this
// preview *is* the confirmation.
export function LibraryImportPreviewDialog({
  open,
  onOpenChange,
  preview,
  data,
  password,
  onImported,
}: LibraryImportPreviewDialogProps) {
  const importMutation = useImportLibrary()

  if (!preview) return null

  const newDownloads = preview.items.length - preview.alreadyInLibrary

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Import preview</DialogTitle>
          <DialogDescription>What this file contains, before you commit to importing it.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{preview.collections.length}</span> collections
            {preview.collectionsNew > 0 && ` (${preview.collectionsNew} new)`}
          </span>
          <span>
            <span className="font-medium text-foreground">{preview.tags.length}</span> tags
            {preview.tagsNew > 0 && ` (${preview.tagsNew} new)`}
          </span>
          <span>
            <span className="font-medium text-foreground">{preview.artists.length}</span> artists
            {preview.artistsNew > 0 && ` (${preview.artistsNew} new)`}
          </span>
          <span>
            <span className="font-medium text-foreground">{preview.items.length}</span> items —{" "}
            <span className="font-medium text-foreground">{newDownloads}</span> will be queued
            {preview.alreadyInLibrary > 0 && `, ${preview.alreadyInLibrary} already in your library`}
          </span>
        </div>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {preview.items.length === 0 ? (
            <p className="px-1 py-1 text-sm text-muted-foreground">No library items in this file.</p>
          ) : (
            preview.items.map((item, i) => <PreviewItemRow key={`${item.originalUrl}-${i}`} item={item} />)
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={() =>
              importMutation.mutate(
                { data, password },
                {
                  onSuccess: () => {
                    onOpenChange(false)
                    onImported()
                  },
                },
              )
            }
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? "Importing…" : "Import Now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PreviewItemRow({ item }: { item: PreviewLibraryItem }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border p-2">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium">{item.title || item.originalUrl}</p>
        <p className="truncate text-xs text-muted-foreground">{item.originalUrl}</p>
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
      {item.alreadyInLibrary && (
        <Badge variant="secondary" className="shrink-0">
          Already in library
        </Badge>
      )}
    </div>
  )
}

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useDeleteLibraryItem } from "@/hooks/useLibrary"
import type { LibraryItem } from "@/types/api"

interface DeleteLibraryItemDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteLibraryItemDialog({ item, open, onOpenChange }: DeleteLibraryItemDialogProps) {
  const deleteLibraryItem = useDeleteLibraryItem()

  const handleDelete = (deleteFiles: boolean) => {
    deleteLibraryItem.mutate({ id: item.id, deleteFiles }, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete "{item.title}"?</DialogTitle>
          <DialogDescription>
            "Remove from library" only deletes the database entry — the file stays on disk.
            "Delete files too" also removes the media file and thumbnail.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => handleDelete(false)}
              disabled={deleteLibraryItem.isPending}
            >
              Remove from library
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleDelete(true)}
              disabled={deleteLibraryItem.isPending}
            >
              Delete files too
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

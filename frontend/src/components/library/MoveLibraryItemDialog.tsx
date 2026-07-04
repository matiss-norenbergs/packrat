import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCollections } from "@/hooks/useCollections"
import { useMoveLibraryItem } from "@/hooks/useLibrary"
import type { LibraryItem } from "@/types/api"

const NO_COLLECTION = "none"

interface MoveLibraryItemDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MoveLibraryItemDialog({ item, open, onOpenChange }: MoveLibraryItemDialogProps) {
  const [collectionId, setCollectionId] = useState(item.collectionId != null ? String(item.collectionId) : NO_COLLECTION)
  const [folder, setFolder] = useState(item.folder)

  const { data: collections } = useCollections()
  const moveLibraryItem = useMoveLibraryItem()

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setCollectionId(item.collectionId != null ? String(item.collectionId) : NO_COLLECTION)
      setFolder(item.folder)
    }
    onOpenChange(next)
  }

  const handleSubmit = () => {
    moveLibraryItem.mutate(
      {
        id: item.id,
        payload: {
          collectionId: collectionId === NO_COLLECTION ? null : Number(collectionId),
          folder: folder.trim(),
        },
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move</DialogTitle>
          <DialogDescription>Physically relocates the media file and thumbnail.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Collection</Label>
            <Select value={collectionId} onValueChange={setCollectionId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COLLECTION}>None</SelectItem>
                {collections?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="move-folder">Folder</Label>
            <Input
              id="move-folder"
              placeholder="(collection root)"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={moveLibraryItem.isPending}>
            {moveLibraryItem.isPending ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

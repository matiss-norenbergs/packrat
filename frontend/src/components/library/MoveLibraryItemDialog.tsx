import { useEffect, useState } from "react"
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
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCollections } from "@/hooks/useCollections"
import { useMoveLibraryItem } from "@/hooks/useLibrary"
import { sortCollectionsByPath } from "@/lib/collectionTree"
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

  // `open` is set externally (the row's dropdown item flips it straight to
  // true, not via a DialogTrigger), so Radix's own onOpenChange never fires
  // on open — only on internally-triggered closes (Escape, overlay, the X
  // button). A plain useEffect is what actually catches every open; without
  // it, fields kept whatever was last picked from a previous open-without-save.
  useEffect(() => {
    if (!open) return
    setCollectionId(item.collectionId != null ? String(item.collectionId) : NO_COLLECTION)
    setFolder(item.folder)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item])

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move</DialogTitle>
          <DialogDescription>Physically relocates the media file and thumbnail.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Collection</Label>
            <Select value={collectionId} onValueChange={setCollectionId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COLLECTION}>None</SelectItem>
                <SelectSeparator />
                {sortCollectionsByPath(collections ?? []).map((c) => (
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

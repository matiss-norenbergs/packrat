import { useEffect, useMemo, useState } from "react"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { useCollections } from "@/hooks/useCollections"
import { useBulkDeleteLibraryItemFiles, useLibraryQuery } from "@/hooks/useLibrary"
import { buildCollectionTree, collectDescendantIds, findNodeById } from "@/lib/collectionTree"
import { LibraryItemPreviewRow } from "./LibraryItemPreviewRow"
import { useSelection } from "./SelectionContext"
import type { LibraryItem } from "@/types/api"

// Mirrors BulkDeleteLibraryItemsDialog's file-preview cap.
const MAX_VISIBLE_FILES = 20

interface BulkDeleteLibraryItemFilesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Removes just the media file (optionally the thumbnail too) for every
// selected item — the DB row, tags, collection membership, and all other
// metadata stay. Items that already have no file (already ghosts) are
// silently skipped server-side rather than failing the batch, so a
// selection spanning both real and placeholder items is fine to submit.
export function BulkDeleteLibraryItemFilesDialog({ open, onOpenChange }: BulkDeleteLibraryItemFilesDialogProps) {
  const { selectedItems, selectedCollectionIds, clear } = useSelection()
  const { data: collections } = useCollections()
  const [deleteThumbnail, setDeleteThumbnail] = useState(false)
  const bulkDeleteLibraryItemFiles = useBulkDeleteLibraryItemFiles()

  // `open` is set externally, not via a trigger — see BulkAssignTagsDialog's
  // identical comment for why a plain effect (not Radix's onOpenChange) is
  // what resets local state on every open.
  useEffect(() => {
    if (open) setDeleteThumbnail(false)
  }, [open])

  const collectionIdsToResolve = useMemo(() => {
    if (selectedCollectionIds.size === 0 || !collections) return []
    const tree = buildCollectionTree(collections)
    const ids = new Set<number>()
    for (const id of selectedCollectionIds) {
      const node = findNodeById(tree, id)
      if (node) for (const d of collectDescendantIds(node)) ids.add(d)
    }
    return [...ids]
  }, [selectedCollectionIds, collections])

  const { data: resolvedFromCollections, isLoading: resolving } = useLibraryQuery(
    { collectionIds: collectionIdsToResolve },
    open && collectionIdsToResolve.length > 0,
  )

  const affectedItems = useMemo(() => {
    const byId = new Map<number, LibraryItem>(selectedItems)
    for (const item of resolvedFromCollections?.items ?? []) byId.set(item.id, item)
    return [...byId.values()]
  }, [selectedItems, resolvedFromCollections])

  const visibleItems = affectedItems.slice(0, MAX_VISIBLE_FILES)
  const hiddenCount = affectedItems.length - visibleItems.length
  const isLoading = collectionIdsToResolve.length > 0 && resolving

  const handleDelete = () => {
    bulkDeleteLibraryItemFiles.mutate(
      { itemIds: affectedItems.map((item) => item.id), deleteThumbnail },
      {
        onSuccess: () => {
          clear()
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-xl!">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {isLoading ? "…" : affectedItems.length} selected {affectedItems.length === 1 ? "file" : "files"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This removes the media file from disk to reclaim space. The library entry, tags,
            collection membership, and all other metadata stay — each item shows a placeholder
            until it's downloaded again. Items that already have no file are skipped.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
          {visibleItems.map((item) => (
            <LibraryItemPreviewRow key={item.id} item={item} />
          ))}
          {hiddenCount > 0 && <p className="px-1 py-1 text-xs text-muted-foreground">+{hiddenCount} more</p>}
          {!isLoading && affectedItems.length === 0 && (
            <p className="px-1 py-1 text-xs text-muted-foreground">No files in this selection.</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="bulk-delete-file-thumbnail"
            checked={deleteThumbnail}
            onCheckedChange={(v) => setDeleteThumbnail(v === true)}
          />
          <Label htmlFor="bulk-delete-file-thumbnail" className="font-normal">
            Also delete thumbnails
          </Label>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={bulkDeleteLibraryItemFiles.isPending || isLoading || affectedItems.length === 0}
          >
            {bulkDeleteLibraryItemFiles.isPending ? "Deleting…" : "Delete file"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

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
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { useCollections } from "@/hooks/useCollections"
import { useBulkDeleteLibraryItems, useLibraryQuery } from "@/hooks/useLibrary"
import { mediaFileUrl } from "@/lib/api"
import { buildCollectionTree, collectDescendantIds, findNodeById } from "@/lib/collectionTree"
import { hashText } from "@/lib/utils"
import { useSelection } from "./SelectionContext"
import type { LibraryItem } from "@/types/api"

// Mirrors BulkAssignTagsDialog's file-preview cap.
const MAX_VISIBLE_FILES = 20

interface BulkDeleteLibraryItemsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BulkDeleteLibraryItemsDialog({ open, onOpenChange }: BulkDeleteLibraryItemsDialogProps) {
  const { selectedItems, selectedCollectionIds, clear } = useSelection()
  const { data: collections } = useCollections()
  const [deleteFiles, setDeleteFiles] = useState(false)
  const bulkDeleteLibraryItems = useBulkDeleteLibraryItems()

  // `open` is set externally, not via a trigger — see BulkAssignTagsDialog's
  // identical comment for why a plain effect (not Radix's onOpenChange) is
  // what resets local state on every open.
  useEffect(() => {
    if (open) setDeleteFiles(false)
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
    bulkDeleteLibraryItems.mutate(
      { itemIds: affectedItems.map((item) => item.id), deleteFiles },
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
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {isLoading ? "…" : affectedItems.length} selected {affectedItems.length === 1 ? "file" : "files"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deleteFiles
              ? "This permanently deletes the file(s) too — this cannot be undone."
              : "Removes the file(s) from the library. The files themselves stay on disk."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
          {visibleItems.map((item) => (
            <div key={item.id} className="flex items-center gap-2 text-sm">
              {item.thumbnail ? (
                <BlurredThumbnail
                  src={mediaFileUrl(item.thumbnail)}
                  className="h-8 w-14 shrink-0 rounded object-cover"
                  blurred={item.blurred}
                  revealed={false}
                  onToggleReveal={() => {}}
                />
              ) : (
                <div className="h-8 w-14 shrink-0 rounded bg-muted" />
              )}
              <span className="truncate">{item.blurred ? hashText(item.title) : item.title}</span>
            </div>
          ))}
          {hiddenCount > 0 && <p className="px-1 py-1 text-xs text-muted-foreground">+{hiddenCount} more</p>}
          {!isLoading && affectedItems.length === 0 && (
            <p className="px-1 py-1 text-xs text-muted-foreground">No files in this selection.</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Checkbox id="bulk-delete-files" checked={deleteFiles} onCheckedChange={(v) => setDeleteFiles(v === true)} />
          <Label htmlFor="bulk-delete-files" className="font-normal">
            Also delete files from disk
          </Label>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={bulkDeleteLibraryItems.isPending || isLoading || affectedItems.length === 0}
          >
            {bulkDeleteLibraryItems.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

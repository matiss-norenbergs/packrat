import { useMemo } from "react"
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
import { useCollections } from "@/hooks/useCollections"
import { useBulkRedownloadLibraryItems, useLibraryQuery } from "@/hooks/useLibrary"
import { buildCollectionTree, collectDescendantIds, findNodeById } from "@/lib/collectionTree"
import { LibraryItemPreviewRow } from "./LibraryItemPreviewRow"
import { useSelection } from "./SelectionContext"
import type { LibraryItem } from "@/types/api"

// Mirrors BulkDeleteLibraryItemFilesDialog's file-preview cap.
const MAX_VISIBLE_ITEMS = 20

interface BulkRedownloadLibraryItemsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Queues a redownload (same mechanism as the single-item "Redownload"/
// "Download now" action) for every selected item that has a source URL —
// items without one can't be filled in this way, so they're filtered out of
// the affected list rather than blocking the whole batch. The triggering
// menu item stays enabled regardless of selection composition; this dialog
// is where the URL-less items quietly drop out.
export function BulkRedownloadLibraryItemsDialog({ open, onOpenChange }: BulkRedownloadLibraryItemsDialogProps) {
  const { selectedItems, selectedCollectionIds, clear } = useSelection()
  const { data: collections } = useCollections()
  const bulkRedownload = useBulkRedownloadLibraryItems()

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
    return [...byId.values()].filter((item) => item.originalUrl)
  }, [selectedItems, resolvedFromCollections])

  const visibleItems = affectedItems.slice(0, MAX_VISIBLE_ITEMS)
  const hiddenCount = affectedItems.length - visibleItems.length
  const isLoading = collectionIdsToResolve.length > 0 && resolving

  const handleDownload = () => {
    bulkRedownload.mutate(
      { itemIds: affectedItems.map((item) => item.id) },
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
            Download {isLoading ? "…" : affectedItems.length} selected {affectedItems.length === 1 ? "file" : "files"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Queues a download from each item's saved source URL — same as using "Download now"/"Redownload" one at a
            time. Items in the selection with no source URL are excluded below and left untouched.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
          {visibleItems.map((item) => (
            <LibraryItemPreviewRow key={item.id} item={item} />
          ))}
          {hiddenCount > 0 && <p className="px-1 py-1 text-xs text-muted-foreground">+{hiddenCount} more</p>}
          {!isLoading && affectedItems.length === 0 && (
            <p className="px-1 py-1 text-xs text-muted-foreground">
              No items with a source URL in this selection.
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDownload}
            disabled={bulkRedownload.isPending || isLoading || affectedItems.length === 0}
          >
            {bulkRedownload.isPending ? "Queuing…" : "Download"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

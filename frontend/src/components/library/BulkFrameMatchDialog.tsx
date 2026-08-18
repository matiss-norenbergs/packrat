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
import { useBulkStartFrameMatch, useFrameMatchQueue } from "@/hooks/useFrameMatchQueue"
import { useLibraryQuery } from "@/hooks/useLibrary"
import { buildCollectionTree, collectDescendantIds, findNodeById } from "@/lib/collectionTree"
import { LibraryItemPreviewRow } from "./LibraryItemPreviewRow"
import { useSelection } from "./SelectionContext"
import type { FrameMatchMode, LibraryItem } from "@/types/api"

// Mirrors BulkDeleteLibraryItemFilesDialog's file-preview cap.
const MAX_VISIBLE_ITEMS = 20

interface BulkFrameMatchDialogProps {
  mode: FrameMatchMode
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Bulk-enqueues frame matching for every eligible selected item, processed
// one at a time in the background — see the "Frame Matching" page for
// progress and to review/use each result. Ghost items (no video file),
// items missing what the requested mode needs (a source URL for "url", an
// existing thumbnail for "current"), and items that already have a row
// (any state) sitting in the queue are excluded from the affected list
// rather than blocking the batch, same tolerance as the other bulk actions
// here — re-matching an already-queued item would just waste a redundant
// scan (the backend enforces this too; filtering here just keeps the
// preview count accurate).
export function BulkFrameMatchDialog({ mode, open, onOpenChange }: BulkFrameMatchDialogProps) {
  const { selectedItems, selectedCollectionIds, clear } = useSelection()
  const { data: collections } = useCollections()
  const { data: queueItems } = useFrameMatchQueue()
  const bulkStartFrameMatch = useBulkStartFrameMatch()

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

  const alreadyQueuedIds = useMemo(
    () => new Set((queueItems ?? []).map((q) => q.libraryItemId)),
    [queueItems],
  )

  const affectedItems = useMemo(() => {
    const byId = new Map<number, LibraryItem>(selectedItems)
    for (const item of resolvedFromCollections?.items ?? []) byId.set(item.id, item)
    return [...byId.values()].filter(
      (item) =>
        item.path && (mode === "url" ? item.originalUrl : item.thumbnail) && !alreadyQueuedIds.has(item.id),
    )
  }, [selectedItems, resolvedFromCollections, mode, alreadyQueuedIds])

  const visibleItems = affectedItems.slice(0, MAX_VISIBLE_ITEMS)
  const hiddenCount = affectedItems.length - visibleItems.length
  const isLoading = collectionIdsToResolve.length > 0 && resolving

  const handleStart = () => {
    bulkStartFrameMatch.mutate(
      { itemIds: affectedItems.map((item) => item.id), mode },
      {
        onSuccess: () => {
          clear()
          onOpenChange(false)
        },
      },
    )
  }

  const noun = mode === "url" ? "source URL" : "current thumbnail"

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-xl!">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Queue {isLoading ? "…" : affectedItems.length} item{affectedItems.length === 1 ? "" : "s"} for matching?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Scans each item's video to find the frame its thumbnail was likely taken from, compared against{" "}
            {mode === "url" ? "a freshly-fetched copy of its source thumbnail" : "its current thumbnail"}. This runs
            one item at a time in the background — review and use each result on the Frame Matching page. Items in
            the selection with no {noun}, or that are already queued for matching, are excluded below and left
            untouched.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
          {visibleItems.map((item) => (
            <LibraryItemPreviewRow key={item.id} item={item} />
          ))}
          {hiddenCount > 0 && <p className="px-1 py-1 text-xs text-muted-foreground">+{hiddenCount} more</p>}
          {!isLoading && affectedItems.length === 0 && (
            <p className="px-1 py-1 text-xs text-muted-foreground">
              No items eligible for matching in this selection — each either has no {noun} or is already queued.
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleStart}
            disabled={bulkStartFrameMatch.isPending || isLoading || affectedItems.length === 0}
          >
            {bulkStartFrameMatch.isPending ? "Queuing…" : "Queue for matching"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

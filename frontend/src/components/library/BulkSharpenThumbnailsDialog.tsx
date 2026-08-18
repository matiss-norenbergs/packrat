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
import { useLibraryQuery } from "@/hooks/useLibrary"
import { useSharpenThumbnailItems } from "@/hooks/useThumbnailEnhancement"
import { buildCollectionTree, collectDescendantIds, findNodeById } from "@/lib/collectionTree"
import { LibraryItemPreviewRow } from "./LibraryItemPreviewRow"
import { useSelection } from "./SelectionContext"
import type { LibraryItem } from "@/types/api"

// Mirrors BulkFrameMatchDialog's file-preview cap.
const MAX_VISIBLE_ITEMS = 20

interface BulkSharpenThumbnailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Bulk-runs a denoise/detail-only pass (no resize, unlike the "Upscale"
// feature) against every eligible selected item's current thumbnail — a
// manual-only action, only ever reachable from here or an item's own
// Thumbnail menu, never from the scheduled sweep or auto-on-download. Ghost
// items (no video file) and items with no current thumbnail are excluded
// from the affected list rather than blocking the batch, same tolerance as
// the other bulk actions here.
export function BulkSharpenThumbnailsDialog({ open, onOpenChange }: BulkSharpenThumbnailsDialogProps) {
  const { selectedItems, selectedCollectionIds, clear } = useSelection()
  const { data: collections } = useCollections()
  const sharpenItems = useSharpenThumbnailItems()

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
    return [...byId.values()].filter((item) => item.path && item.thumbnail)
  }, [selectedItems, resolvedFromCollections])

  const visibleItems = affectedItems.slice(0, MAX_VISIBLE_ITEMS)
  const hiddenCount = affectedItems.length - visibleItems.length
  const isLoading = collectionIdsToResolve.length > 0 && resolving

  const handleStart = () => {
    sharpenItems.mutate(
      affectedItems.map((item) => item.id),
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
            {affectedItems.length === 1
              ? `Sharpen ${isLoading ? "…" : affectedItems.length} item's thumbnail?`
              : `Sharpen ${isLoading ? "…" : affectedItems.length} items' thumbnails?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Runs each thumbnail through your configured Stable Diffusion WebUI instance for a
            denoise/detail pass only — the output stays the same size, it's not upscaled. This runs
            one item at a time in the background; check the AI Enhancement page for progress. Items
            in the selection with no current thumbnail are excluded below and left untouched.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
          {visibleItems.map((item) => (
            <LibraryItemPreviewRow key={item.id} item={item} />
          ))}
          {hiddenCount > 0 && <p className="px-1 py-1 text-xs text-muted-foreground">+{hiddenCount} more</p>}
          {!isLoading && affectedItems.length === 0 && (
            <p className="px-1 py-1 text-xs text-muted-foreground">No items with a current thumbnail in this selection.</p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleStart}
            disabled={sharpenItems.isPending || isLoading || affectedItems.length === 0}
          >
            {sharpenItems.isPending ? "Queuing…" : "Sharpen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

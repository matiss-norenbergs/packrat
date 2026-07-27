import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { useCollections } from "@/hooks/useCollections"
import { useAddToCompareList } from "@/hooks/useCompareList"
import { useLibraryQuery } from "@/hooks/useLibrary"
import { librarySmallThumbnailUrl } from "@/lib/api"
import { buildCollectionTree, collectDescendantIds, findNodeById } from "@/lib/collectionTree"
import { hashText } from "@/lib/utils"
import { useSelection } from "./SelectionContext"
import type { LibraryItem } from "@/types/api"

// Caps how many affected files are listed before collapsing the rest into a
// "+N more" line — mirrors BulkAssignTagsDialog's preview list.
const MAX_VISIBLE_FILES = 20

interface AddToCompareListDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Same selection-resolution recipe as BulkAssignTagsDialog/BulkDeleteLibraryItemsDialog
// — merges individually-selected items with items resolved from any
// selected whole collections — but with no fields to fill in, so it's just
// a preview + confirm rather than a form.
export function AddToCompareListDialog({ open, onOpenChange }: AddToCompareListDialogProps) {
  const { selectedItems, selectedCollectionIds, clear } = useSelection()
  const { data: collections } = useCollections()
  const addToCompareList = useAddToCompareList()

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

  const handleAdd = () => {
    addToCompareList.mutate(
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Add to compare list</DialogTitle>
          <DialogDescription>
            Adds every file below to the compare list, where you can pick up to 6 at a time to play
            side by side.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>{isLoading ? "Resolving files…" : `${affectedItems.length} ${affectedItems.length === 1 ? "file" : "files"} will be added`}</Label>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
            {visibleItems.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-sm">
                {librarySmallThumbnailUrl(item) ? (
                  <BlurredThumbnail
                    src={librarySmallThumbnailUrl(item)!}
                    className="h-8 w-14 shrink-0 rounded object-cover"
                    blurred={item.blurred}
                    revealed={false}
                    onToggleReveal={() => {}}
                  />
                ) : (
                  <div className="h-8 w-14 shrink-0 rounded bg-muted" />
                )}
                <span className="min-w-0 flex-1 truncate">{item.blurred ? hashText(item.title) : item.title}</span>
              </div>
            ))}
            {hiddenCount > 0 && <p className="px-1 py-1 text-xs text-muted-foreground">+{hiddenCount} more</p>}
            {!isLoading && affectedItems.length === 0 && (
              <p className="px-1 py-1 text-xs text-muted-foreground">No files in this selection.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleAdd} disabled={addToCompareList.isPending || isLoading || affectedItems.length === 0}>
            {addToCompareList.isPending ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

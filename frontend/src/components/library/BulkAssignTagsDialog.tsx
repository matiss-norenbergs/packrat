import { useEffect, useMemo, useState } from "react"
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
import { useBulkAssignTags, useLibraryQuery } from "@/hooks/useLibrary"
import { useTags } from "@/hooks/useTags"
import { mediaFileUrl } from "@/lib/api"
import { buildCollectionTree, collectDescendantIds, findNodeById } from "@/lib/collectionTree"
import { hashText } from "@/lib/utils"
import { TagInput } from "./TagInput"
import { useSelection } from "./SelectionContext"
import type { LibraryItem } from "@/types/api"

// Caps how many affected files are listed before collapsing the rest into a
// "+N more" line — mirrors the tag-badge collapsing idiom on LibraryCard.
const MAX_VISIBLE_FILES = 20

interface BulkAssignTagsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BulkAssignTagsDialog({ open, onOpenChange }: BulkAssignTagsDialogProps) {
  const { selectedItems, selectedCollectionIds, clear } = useSelection()
  const { data: collections } = useCollections()
  const { data: allTags } = useTags()
  const [tags, setTags] = useState<string[]>([])
  const bulkAssignTags = useBulkAssignTags()

  // `open` is set externally (the toolbar's dropdown item flips it straight
  // to true, not via a DialogTrigger), so Radix's own onOpenChange never
  // fires on open — only on internally-triggered closes (Escape, overlay,
  // the X button). A plain useEffect is what actually catches every open.
  useEffect(() => {
    if (open) setTags([])
  }, [open])

  // Selecting a folder means every file in that collection tree, including
  // nested subcollections — resolve to concrete collection ids here.
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

  // Only fetches once the dialog is actually open — a whole-collection
  // selection shouldn't trigger a query on every checkbox click.
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

  const handleSave = () => {
    bulkAssignTags.mutate(
      { itemIds: affectedItems.map((item) => item.id), tags },
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
          <DialogTitle>Assign tags</DialogTitle>
          <DialogDescription>
            This replaces all tags on every file below — tags not included here will be removed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>{isLoading ? "Resolving files…" : `${affectedItems.length} ${affectedItems.length === 1 ? "file" : "files"} will be changed`}</Label>
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
                <span className="min-w-0 flex-1 truncate">{item.blurred ? hashText(item.title) : item.title}</span>
              </div>
            ))}
            {hiddenCount > 0 && <p className="px-1 py-1 text-xs text-muted-foreground">+{hiddenCount} more</p>}
            {!isLoading && affectedItems.length === 0 && (
              <p className="px-1 py-1 text-xs text-muted-foreground">No files in this selection.</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Tags</Label>
          <TagInput value={tags} onChange={setTags} suggestions={allTags?.map((t) => t.name) ?? []} />
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={bulkAssignTags.isPending || isLoading || affectedItems.length === 0}>
            {bulkAssignTags.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

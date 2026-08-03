import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useCollections } from "@/hooks/useCollections"
import { libraryQueryKey, useLibraryQuery } from "@/hooks/useLibrary"
import { updateLibraryItem } from "@/lib/api"
import { buildCollectionTree, collectDescendantIds, findNodeById } from "@/lib/collectionTree"
import { LibraryItemPreviewRow } from "./LibraryItemPreviewRow"
import { useSelection } from "./SelectionContext"
import type { LibraryItem } from "@/types/api"

const MAX_VISIBLE_FILES = 20

interface BulkSetGenerateNfoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BulkSetGenerateNfoDialog({ open, onOpenChange }: BulkSetGenerateNfoDialogProps) {
  const { selectedItems, selectedCollectionIds, clear } = useSelection()
  const { data: collections } = useCollections()
  const queryClient = useQueryClient()
  const [generateNfo, setGenerateNfo] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (open) setGenerateNfo(true)
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

  const handleSave = async () => {
    setIsSaving(true)
    const results = await Promise.allSettled(
      affectedItems.map((item) => updateLibraryItem(item.id, { generateNfo })),
    )
    setIsSaving(false)

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    const failed = results.length - succeeded

    queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    if (succeeded > 0) toast.success(`Updated ${succeeded} file${succeeded === 1 ? "" : "s"}`)
    if (failed > 0) toast.error(`${failed} file${failed === 1 ? "" : "s"} failed to update`)

    clear()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Generate NFO</DialogTitle>
          <DialogDescription>Sets whether a .nfo sidecar file is kept in sync for every file below.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>{isLoading ? "Resolving files…" : `${affectedItems.length} ${affectedItems.length === 1 ? "file" : "files"} will be changed`}</Label>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
            {visibleItems.map((item) => (
              <LibraryItemPreviewRow key={item.id} item={item} />
            ))}
            {hiddenCount > 0 && <p className="px-1 py-1 text-xs text-muted-foreground">+{hiddenCount} more</p>}
            {!isLoading && affectedItems.length === 0 && (
              <p className="px-1 py-1 text-xs text-muted-foreground">No files in this selection.</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox id="bulk-generate-nfo" checked={generateNfo} onCheckedChange={(v) => setGenerateNfo(v === true)} />
          <Label htmlFor="bulk-generate-nfo" className="font-normal">
            Generate NFO
          </Label>
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={isSaving || isLoading || affectedItems.length === 0}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCollections } from "@/hooks/useCollections"
import { libraryQueryKey, useLibraryQuery } from "@/hooks/useLibrary"
import { updateLibraryItem } from "@/lib/api"
import { buildCollectionTree, collectDescendantIds, findNodeById } from "@/lib/collectionTree"
import { buildLibraryItemUpdatePayload, libraryItemToEditFields, type LibraryItemEditFields } from "@/lib/libraryItemEdit"
import { BulkEditLibraryItemRow } from "./BulkEditLibraryItemRow"
import { useSelection } from "./SelectionContext"
import type { LibraryItem } from "@/types/api"

interface BulkEditLibraryItemsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Row {
  item: LibraryItem
  fields: LibraryItemEditFields
}

export function BulkEditLibraryItemsDialog({ open, onOpenChange }: BulkEditLibraryItemsDialogProps) {
  const { selectedItems, selectedCollectionIds, clear } = useSelection()
  const { data: collections } = useCollections()
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<Row[]>([])
  const [isSaving, setIsSaving] = useState(false)

  // Same whole-collection-to-concrete-items resolution as BulkAssignTagsDialog.
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

  const isLoading = collectionIdsToResolve.length > 0 && resolving

  // Rows hold independent, per-item editable state, so they can only be
  // (re)built once per dialog-open — not on every affectedItems reference
  // change, or a background refetch while the user is mid-edit would wipe
  // their in-progress changes. Deferred until collection resolution (if any)
  // has actually settled, so late-arriving items still get a row.
  const initializedRef = useRef(false)
  useEffect(() => {
    if (!open) {
      initializedRef.current = false
      return
    }
    if (isLoading || initializedRef.current) return
    initializedRef.current = true
    setRows(affectedItems.map((item) => ({ item, fields: libraryItemToEditFields(item) })))
  }, [open, isLoading, affectedItems])

  const updateRowFields = (index: number, patch: Partial<LibraryItemEditFields>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, fields: { ...row.fields, ...patch } } : row)))
  }

  const handleSave = async () => {
    const toSave = rows
      .map(({ item, fields }) => ({ item, payload: buildLibraryItemUpdatePayload(item, fields) }))
      .filter(({ payload }) => Object.keys(payload).length > 0)

    if (toSave.length === 0) {
      onOpenChange(false)
      return
    }

    setIsSaving(true)
    const results = await Promise.allSettled(toSave.map(({ item, payload }) => updateLibraryItem(item.id, payload)))
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
      <DialogContent className="sm:max-w-4xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Edit {isLoading ? "…" : rows.length} selected {rows.length === 1 ? "file" : "files"}</DialogTitle>
          <DialogDescription>
            Every field below starts at that file's current value — only fields you actually change
            are saved, per file.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {isLoading ? (
            <p className="px-1 py-1 text-sm text-muted-foreground">Resolving files…</p>
          ) : rows.length === 0 ? (
            <p className="px-1 py-1 text-sm text-muted-foreground">No files in this selection.</p>
          ) : (
            rows.map((row, index) => (
              <BulkEditLibraryItemRow
                key={row.item.id}
                item={row.item}
                rowNumber={index}
                fields={row.fields}
                onChange={(patch) => updateRowFields(index, patch)}
              />
            ))
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={isSaving || isLoading || rows.length === 0}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

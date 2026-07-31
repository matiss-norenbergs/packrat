import { useEffect, useMemo, useRef, useState } from "react"
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { useCollections } from "@/hooks/useCollections"
import { libraryQueryKey, useLibraryQuery } from "@/hooks/useLibrary"
import { useMediaQuery } from "@/hooks/useMediaQuery"
import { updateLibraryItem } from "@/lib/api"
import { buildCollectionTree, collectDescendantIds, findNodeById } from "@/lib/collectionTree"
import { cn } from "@/lib/utils"
import {
  buildRenderNodes,
  computeDisplayNumbers,
  moveToPosition,
  normalizeHead,
  positionMap,
  seedSequenceArrangement,
  type ArrangementState,
} from "@/lib/sequenceArrangement"
import { SequenceGapInsertButton, SequenceGapMarker } from "./SequenceGapMarker"
import { SequencedItemRow } from "./SequencedItemRow"
import { useSelection } from "./SelectionContext"
import { UnsequencedItemRow } from "./UnsequencedItemRow"
import type { LibraryItem } from "@/types/api"

interface EditSequenceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const EMPTY_ARRANGEMENT: ArrangementState = { sequencedList: [], leadingGap: 0, unsequencedList: [] }

export function EditSequenceDialog({ open, onOpenChange }: EditSequenceDialogProps) {
  const { selectedItems, selectedCollectionIds, clear } = useSelection()
  const { data: collections } = useCollections()
  const queryClient = useQueryClient()
  const [arrangement, setArrangement] = useState<ArrangementState>(EMPTY_ARRANGEMENT)
  const [isSaving, setIsSaving] = useState(false)
  // Purely a display-order preference — every item's actual number and every
  // gap's actual size stay exactly what they are; "descending" just reads
  // the same data highest-to-lowest instead of lowest-to-highest (so the
  // leading gap, the start of the sequence, ends up at the bottom).
  const [direction, setDirection] = useState<"asc" | "desc">("asc")
  // Gates the resizable side-by-side layout — react-resizable-panels sets
  // its own inline flex-basis on each panel, which would keep applying at
  // every viewport size regardless of any Tailwind lg: classes layered on
  // top, so the two-column/resizable structure has to not be mounted at all
  // below lg rather than just hidden via CSS. matches Tailwind's default lg
  // breakpoint (1024px).
  const isWideScreen = useMediaQuery("(min-width: 1024px)")

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Same whole-collection-to-concrete-items resolution as BulkEditLibraryItemsDialog.
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

  // Seeded once per open, same guard convention as BulkEditLibraryItemsDialog
  // — otherwise a background refetch while the user is mid-drag would blow
  // away their in-progress arrangement.
  const initializedRef = useRef(false)
  useEffect(() => {
    if (!open) {
      initializedRef.current = false
      setDirection("asc")
      return
    }
    if (isLoading || initializedRef.current) return
    initializedRef.current = true
    setArrangement(seedSequenceArrangement(affectedItems))
  }, [open, isLoading, affectedItems])

  const { sequencedList, leadingGap, unsequencedList } = arrangement
  const displayNumbers = computeDisplayNumbers(leadingGap, sequencedList)
  const numberByItemId = new Map(sequencedList.map((e, i) => [e.item.id, displayNumbers[i]]))
  const maxNumber = displayNumbers.length > 0 ? displayNumbers[displayNumbers.length - 1] : 0
  const positions = positionMap(leadingGap, sequencedList)
  const renderNodes = buildRenderNodes(leadingGap, sequencedList, direction)
  const sortableIds = (direction === "desc" ? [...sequencedList].reverse() : sequencedList).map((e) => e.item.id)

  const adjustGap = (index: number, delta: number) => {
    setArrangement((prev) => {
      if (index === 0) {
        return { ...prev, leadingGap: Math.max(0, prev.leadingGap + delta) }
      }
      const list = [...prev.sequencedList]
      list[index] = { ...list[index], gapBefore: Math.max(0, list[index].gapBefore + delta) }
      return { ...prev, sequencedList: list }
    })
  }

  // Arrows always move a row toward the top/bottom of the *current display*
  // — which number that corresponds to flips with direction, since
  // descending reads highest-to-lowest. Routed through moveToPosition
  // (rather than a raw array-index swap) so stepping into a reserved gap
  // works the same as stepping onto a real neighbor: the vacated slot
  // becomes a new gap instead of the move being blocked.
  const moveArrowStep = (itemId: number, currentNumber: number, screenDirection: "up" | "down") => {
    const numberDelta = (screenDirection === "up") === (direction === "asc") ? -1 : 1
    setArrangement((prev) => moveToPosition(prev, itemId, currentNumber + numberDelta))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setArrangement((prev) => {
      // Reorder within whichever order is currently on screen, then flip
      // back to the canonical ascending storage order — gapBefore values
      // stay attached to their own item throughout, so this never touches
      // any gap's size, only which items are adjacent to which.
      const displayOrder = direction === "desc" ? [...prev.sequencedList].reverse() : prev.sequencedList
      const oldIndex = displayOrder.findIndex((e) => e.item.id === active.id)
      const newIndex = displayOrder.findIndex((e) => e.item.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      const reordered = arrayMove(displayOrder, oldIndex, newIndex)
      const newSequencedList = direction === "desc" ? [...reordered].reverse() : reordered
      return normalizeHead({ ...prev, sequencedList: newSequencedList })
    })
  }

  const handleJumpToPosition = (itemId: number, position: number) => {
    setArrangement((prev) => moveToPosition(prev, itemId, position))
  }

  const handleSave = async () => {
    const toSave = sequencedList
      .map((entry, i) => ({ item: entry.item, newNumber: displayNumbers[i] }))
      .filter(({ item, newNumber }) => item.sequenceNumber !== newNumber)

    if (toSave.length === 0) {
      onOpenChange(false)
      return
    }

    setIsSaving(true)
    const results = await Promise.allSettled(
      toSave.map(({ item, newNumber }) => updateLibraryItem(item.id, { sequenceNumber: newNumber })),
    )
    setIsSaving(false)

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    const failed = results.length - succeeded

    queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    if (succeeded > 0) toast.success(`Renumbered ${succeeded} file${succeeded === 1 ? "" : "s"}`)
    if (failed > 0) toast.error(`${failed} file${failed === 1 ? "" : "s"} failed to update`)

    clear()
    onOpenChange(false)
  }

  const totalCount = sequencedList.length + unsequencedList.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Scales with the viewport from lg up (80-85% range) instead of
          topping out at a fixed rem size — this dialog's two-panel layout
          benefits from real screen space on a big monitor more than most
          dialogs do. */}
      <DialogContent className="sm:max-w-3xl lg:max-w-[85vw]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Edit sequence — {isLoading ? "…" : totalCount} selected {totalCount === 1 ? "file" : "files"}</DialogTitle>
          <DialogDescription>
            Drag, use the arrows, or jump an item straight to a position. Gaps ("N missing") are
            preserved exactly as they are unless you deliberately fill or resize them — only files
            whose number actually changes get saved.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Ordered by sequence, {direction === "asc" ? "ascending" : "descending"}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDirection((d) => (d === "asc" ? "desc" : "asc"))}
            disabled={sequencedList.length < 2}
          >
            Reverse order
          </Button>
        </div>

        {(() => {
          const showSplitLayout = isWideScreen && !isLoading && unsequencedList.length > 0

          const sequencedContent = (
            <div className={cn("space-y-1", showSplitLayout ? "h-full overflow-y-auto pr-2" : "max-h-[55vh] overflow-y-auto")}>
              {isLoading ? (
                <p className="px-1 py-1 text-sm text-muted-foreground">Resolving files…</p>
              ) : sequencedList.length === 0 ? (
                <p className="px-1 py-1 text-sm text-muted-foreground">
                  Nothing sequenced yet — add an item from the list below.
                </p>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                    {renderNodes.map((node) => {
                      if (node.kind === "gap") {
                        return node.size > 0 ? (
                          <SequenceGapMarker
                            key={node.key}
                            count={node.size}
                            onIncrement={() => adjustGap(node.index, 1)}
                            onDecrement={() => adjustGap(node.index, -1)}
                          />
                        ) : (
                          <SequenceGapInsertButton key={node.key} onInsert={() => adjustGap(node.index, 1)} />
                        )
                      }
                      const displayNumber = numberByItemId.get(node.entry.item.id)!
                      return (
                        <SequencedItemRow
                          key={node.entry.item.id}
                          item={node.entry.item}
                          displayNumber={displayNumber}
                          rowNumber={node.index}
                          positions={positions}
                          canMoveUp={direction === "asc" ? displayNumber > 1 : displayNumber < maxNumber}
                          canMoveDown={direction === "asc" ? displayNumber < maxNumber : displayNumber > 1}
                          onMoveUp={() => moveArrowStep(node.entry.item.id, displayNumber, "up")}
                          onMoveDown={() => moveArrowStep(node.entry.item.id, displayNumber, "down")}
                          onJumpToPosition={(position) => handleJumpToPosition(node.entry.item.id, position)}
                        />
                      )
                    })}
                  </SortableContext>
                </DndContext>
              )}
            </div>
          )

          const unsequencedContent = !isLoading && unsequencedList.length > 0 && (
            <div className={cn("space-y-2", showSplitLayout ? "h-full overflow-y-auto pl-2" : "mt-4 border-t pt-3")}>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                No sequence number ({unsequencedList.length})
              </p>
              <div className={cn("space-y-1", showSplitLayout ? "" : "max-h-40 overflow-y-auto")}>
                {unsequencedList.map((item) => (
                  <UnsequencedItemRow
                    key={item.id}
                    item={item}
                    positions={positions}
                    onJumpToPosition={(position) => handleJumpToPosition(item.id, position)}
                  />
                ))}
              </div>
            </div>
          )

          // The resizable side-by-side layout is only mounted at all when
          // wide — see isWideScreen's comment for why this can't just be a
          // CSS breakpoint on an always-mounted ResizablePanelGroup. Below
          // lg (or with nothing unsequenced to show), it's the original
          // plain stacked layout, full width, no resize handle.
          return showSplitLayout ? (
            <ResizablePanelGroup direction="horizontal" className="h-[60vh]">
              <ResizablePanel defaultSize={65} minSize={40}>
                {sequencedContent}
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={35} minSize={20} maxSize={50}>
                {unsequencedContent}
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <>
              {sequencedContent}
              {unsequencedContent}
            </>
          )
        })()}

        <DialogFooter>
          <Button onClick={handleSave} disabled={isSaving || isLoading || sequencedList.length === 0}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

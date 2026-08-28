import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Eye, Loader2, Trash2 } from "lucide-react"
import { Link } from "react-router-dom"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FrameMatchResult } from "@/components/library/FrameMatchResult"
import { useAcceptFrameMatchQueueItem, useDiscardFrameMatchQueueItem, useFrameMatchQueue } from "@/hooks/useFrameMatchQueue"
import { useIdSelection } from "@/hooks/useIdSelection"
import { imageUrl } from "@/lib/api"
import { getPageNumbers } from "@/lib/pagination"
import type { FrameMatchQueueItem } from "@/types/api"

const PAGE_SIZE = 25

function stateBadgeVariant(state: FrameMatchQueueItem["state"]): "success" | "secondary" | "destructive" | "outline" {
  switch (state) {
    case "done":
      return "success"
    case "running":
      return "secondary"
    case "error":
      return "destructive"
    default:
      return "outline"
  }
}

function ErrorBadge({ error }: { error: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-destructive"
          aria-label="Match failed"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="text-xs text-muted-foreground"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {error}
      </PopoverContent>
    </Popover>
  )
}

// FrameMatchingPage is a working queue, not a permanent history — items
// bulk-enqueued from the Library toolbar's "Match from URL/Current
// Thumbnail…" actions land here, and once accepted, discarded, or
// dismissed, they're deleted outright (see useDiscardFrameMatchQueueItem).
// Live progress arrives over the frame_match_progress WebSocket event
// rather than polling.
export function FrameMatchingPage() {
  const { data: items, isLoading } = useFrameMatchQueue()
  const acceptItem = useAcceptFrameMatchQueueItem()
  const discardItem = useDiscardFrameMatchQueueItem()
  const { selected, isSelected, toggle, clear, selectAll, selectOnly, size, active } = useIdSelection()
  const singleSelected = size === 1 ? (items ?? []).find((i) => selected.has(i.id)) : undefined
  const canReview = singleSelected?.state === "done"
  const [reviewingId, setReviewingId] = useState<number | null>(null)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const [page, setPage] = useState(1)

  // Drag-to-select: mousedown on a row starts the drag and anchors the
  // range; mouseenter on subsequent rows while the button is held extends
  // the selection to every row between the anchor and the row under the
  // cursor. A window-level mouseup ends the drag even if the button is
  // released outside the table. Mirrors ThumbnailEnhancementPage's row
  // selection.
  const [isDragging, setIsDragging] = useState(false)
  const dragAnchorIdRef = useRef<number | null>(null)

  // Radix's ContextMenu only computes the floating menu's position when its
  // content actually (re)mounts — keying ContextMenuContent on this counter
  // forces a genuine remount (and fresh position read) on every right-click.
  const [contextMenuAnchorKey, setContextMenuAnchorKey] = useState(0)

  useEffect(() => {
    if (!isDragging) return
    const onMouseUp = () => setIsDragging(false)
    window.addEventListener("mouseup", onMouseUp)
    return () => window.removeEventListener("mouseup", onMouseUp)
  }, [isDragging])

  const isInteractiveTarget = (e: React.MouseEvent) =>
    (e.target as HTMLElement).closest('[role="checkbox"], button, a') != null

  const rangeIds = (anchorId: number, targetId: number) => {
    const anchorIdx = pageItems.findIndex((i) => i.id === anchorId)
    const targetIdx = pageItems.findIndex((i) => i.id === targetId)
    if (anchorIdx === -1 || targetIdx === -1) return null
    const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    return pageItems.slice(start, end + 1).map((i) => i.id)
  }

  // Plain click (no drag) selects only this row, deselecting everything
  // else. Ctrl/Cmd+click toggles just this row in or out of the current
  // selection, and Shift+click selects the range from the last-clicked row
  // to this one. The checkbox and the row's title link keep their own click
  // behavior.
  const handleRowMouseDown = (e: React.MouseEvent, id: number) => {
    if (e.button !== 0 || isInteractiveTarget(e)) return
    e.preventDefault()

    if (e.shiftKey && dragAnchorIdRef.current != null) {
      const ids = rangeIds(dragAnchorIdRef.current, id)
      if (ids) {
        selectAll(ids)
        return
      }
    }

    if (e.ctrlKey || e.metaKey) {
      toggle(id)
      dragAnchorIdRef.current = id
      return
    }

    dragAnchorIdRef.current = id
    setIsDragging(true)
    selectOnly(id)
  }

  const handleRowMouseEnter = (id: number) => {
    if (!isDragging || dragAnchorIdRef.current == null) return
    const ids = rangeIds(dragAnchorIdRef.current, id)
    if (ids) selectAll(ids)
  }

  // Right-clicking a row that isn't part of the current selection replaces
  // the selection with just that row (mirroring left-click); right-clicking
  // a row that's already selected leaves a multi-selection intact. Right-
  // clicking outside a row isn't a row action, so it shouldn't open a menu.
  const handleTableContextMenu = (e: React.MouseEvent) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>("tr[data-queue-id]")
    if (!rowEl) {
      e.preventDefault()
      return
    }
    const id = Number(rowEl.dataset.queueId)
    if (!selected.has(id)) selectOnly(id)
    setContextMenuAnchorKey((k) => k + 1)
  }

  const total = items?.length ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageItems = (items ?? []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // The queue is short-lived and small — reset to page 1 whenever it shrinks
  // out from under the current page (e.g. the last row on page 2 gets
  // accepted), and drop any selected ids that no longer exist.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])
  useEffect(() => {
    if (!items) return
    const liveIds = new Set(items.map((i) => i.id))
    if ([...selected].some((id) => !liveIds.has(id))) clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const reviewing = items?.find((i) => i.id === reviewingId) ?? null
  const allSelected = pageItems.length > 0 && pageItems.every((i) => isSelected(i.id))
  const someSelected = size > 0 && !allSelected

  const handleDiscardSelected = () => {
    for (const id of selected) discardItem.mutate(id)
    clear()
    setConfirmDiscardOpen(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold">Frame Matching</h1>
        <p className="text-sm text-muted-foreground">
          Items queued from the Library toolbar's "Match from URL/Current Thumbnail…" bulk actions. Review each
          match, then use or discard it — resolved items are removed from this list, not kept as a history.
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button size="sm" disabled={!canReview} onClick={() => canReview && setReviewingId(singleSelected!.id)}>
          <Eye className="h-4 w-4" />
          Review
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={!active || discardItem.isPending}
          onClick={() => setConfirmDiscardOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          Discard
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !items || items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing queued right now.</p>
        ) : (
          <ContextMenu>
            <ContextMenuTrigger asChild onContextMenu={handleTableContextMenu}>
              <Table containerClassName="h-full overflow-auto rounded-md border">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 text-center">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        onCheckedChange={(checked) => (checked ? selectAll(pageItems.map((i) => i.id)) : clear())}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-center">Mode</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageItems.map((item) => (
                    <TableRow
                      key={item.id}
                      data-queue-id={item.id}
                      data-state={isSelected(item.id) ? "selected" : undefined}
                      className="cursor-default select-none"
                      onMouseDown={(e) => handleRowMouseDown(e, item.id)}
                      onMouseEnter={() => handleRowMouseEnter(item.id)}
                    >
                      <TableCell className="text-center">
                        <Checkbox
                          checked={isSelected(item.id)}
                          onCheckedChange={() => toggle(item.id)}
                          aria-label={`Select ${item.itemTitle}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/library/${item.libraryItemId}`}
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          {item.itemTitle}
                        </Link>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{item.mode === "url" ? "From URL" : "From current"}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={stateBadgeVariant(item.state)} className="capitalize">
                            {item.state === "running" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                            {item.state}
                          </Badge>
                          {item.state === "done" && item.score != null && (
                            <span className="text-xs text-muted-foreground">
                              {Math.round(item.score)}% confidence
                            </span>
                          )}
                          {item.state === "error" && item.error && <ErrorBadge error={item.error} />}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ContextMenuTrigger>
            <ContextMenuContent key={contextMenuAnchorKey}>
              <ContextMenuItem disabled={!canReview} onClick={() => canReview && setReviewingId(singleSelected!.id)}>
                <Eye className="h-4 w-4" />
                Review
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" disabled={!active} onClick={() => setConfirmDiscardOpen(true)}>
                <Trash2 className="h-4 w-4" />
                Discard
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
      </div>

      {!isLoading && items && items.length > 0 && (
        <div className="flex shrink-0 items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {total} {total === 1 ? "item" : "items"}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            {getPageNumbers(page, totalPages).map((p, i) =>
              p === "ellipsis" ? (
                <span key={`ellipsis-${i}`} className="px-1.5 text-sm text-muted-foreground">
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === page ? "default" : "outline"}
                  size="sm"
                  className="w-8 px-0"
                  onClick={() => setPage(p)}
                >
                  {p}
                </Button>
              ),
            )}
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <Dialog open={reviewing != null} onOpenChange={(open) => !open && setReviewingId(null)}>
        <DialogContent className="sm:max-w-[80vw] max-h-[90vh] min-w-0 overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Match found</DialogTitle>
            <DialogDescription>Compare against the reference before using it.</DialogDescription>
          </DialogHeader>

          {reviewing && (
            <FrameMatchResult
              libraryItemId={reviewing.libraryItemId}
              referenceUrl={reviewing.referenceImagePath ? imageUrl(reviewing.referenceImagePath) : ""}
              foundUrl={reviewing.foundFramePath ? imageUrl(reviewing.foundFramePath) : ""}
              timestampSeconds={reviewing.timestampSeconds ?? null}
              score={reviewing.score ?? 0}
              itemTitle={reviewing.itemTitle}
            />
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (reviewing) discardItem.mutate(reviewing.id)
              }}
              disabled={discardItem.isPending}
            >
              Discard
            </Button>
            <Button
              onClick={() => {
                if (reviewing) acceptItem.mutate(reviewing.id, { onSuccess: () => setReviewingId(null) })
              }}
              disabled={acceptItem.isPending}
            >
              Use this frame
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Discard {size} {size === 1 ? "item" : "items"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Removes the selected rows from the queue without touching any item's thumbnail. A still-running match
              finishes in the background but its result is discarded on completion. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscardSelected}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

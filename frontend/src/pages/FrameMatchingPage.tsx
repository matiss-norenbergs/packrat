import { useEffect, useState } from "react"
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DataTable } from "@/components/data-table"
import type { ColumnDef } from "@/components/data-table"
import { FrameMatchResult } from "@/components/library/FrameMatchResult"
import { useAcceptFrameMatchQueueItem, useDiscardFrameMatchQueueItem, useFrameMatchQueue } from "@/hooks/useFrameMatchQueue"
import { useIdSelection } from "@/hooks/useIdSelection"
import { imageUrl } from "@/lib/api"
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

const columns: ColumnDef<FrameMatchQueueItem>[] = [
  {
    key: "item",
    header: "Item",
    cell: (item) => (
      <Link to={`/library/${item.libraryItemId}`} className="underline underline-offset-2 hover:text-foreground">
        {item.itemTitle}
      </Link>
    ),
  },
  {
    key: "mode",
    header: "Mode",
    type: "status",
    cell: (item) => <Badge variant="outline">{item.mode === "url" ? "From URL" : "From current"}</Badge>,
  },
  {
    key: "state",
    header: "State",
    type: "status",
    cell: (item) => (
      <div className="flex items-center justify-center gap-1.5">
        <Badge variant={stateBadgeVariant(item.state)} className="capitalize">
          {item.state === "running" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {item.state}
        </Badge>
        {item.state === "done" && item.score != null && (
          <span className="text-xs text-muted-foreground">{Math.round(item.score)}% confidence</span>
        )}
        {item.state === "error" && item.error && <ErrorBadge error={item.error} />}
      </div>
    ),
  },
]

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
  const selection = useIdSelection()
  const { selected, clear, size, active } = selection
  const singleSelected = size === 1 ? (items ?? []).find((i) => selected.has(i.id)) : undefined
  const canReview = singleSelected?.state === "done"
  const [reviewingId, setReviewingId] = useState<number | null>(null)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)

  // The queue is short-lived and small — drop any selected ids that left it (accepted, discarded, or
  // dismissed elsewhere). The table snaps its own page back when the queue shrinks under it.
  useEffect(() => {
    if (!items) return
    const liveIds = new Set(items.map((i) => i.id))
    if ([...selected].some((id) => !liveIds.has(id))) clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const reviewing = items?.find((i) => i.id === reviewingId) ?? null

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

      <DataTable
        rows={items ?? []}
        getRowId={(i) => i.id}
        columns={columns}
        selection="multi"
        selectionState={selection}
        getRowLabel={(i) => `Select ${i.itemTitle}`}
        loading={isLoading}
        empty={<p className="text-sm text-muted-foreground">Nothing queued right now.</p>}
        pageSize={PAGE_SIZE}
        itemLabel={{ singular: "item", plural: "items" }}
        toolbar={
          <>
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
          </>
        }
        contextMenu={(rows) => [
          {
            key: "review",
            label: "Review",
            icon: <Eye className="h-4 w-4" />,
            disabled: rows.length !== 1 || rows[0].state !== "done",
            onSelect: ([item]) => setReviewingId(item.id),
          },
          {
            key: "discard",
            label: "Discard",
            icon: <Trash2 className="h-4 w-4" />,
            destructive: true,
            disabled: rows.length === 0,
            onSelect: () => setConfirmDiscardOpen(true),
          },
        ]}
      />

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

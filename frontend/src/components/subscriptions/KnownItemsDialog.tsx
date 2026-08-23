import { useEffect, useRef, useState } from "react"
import { Download, Eye, Ghost, Link2, Link2Off } from "lucide-react"
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  useBulkAddSubscriptionEntries,
  useBulkMarkSubscriptionEntriesSeen,
  useBulkUnlinkSubscriptionEntries,
  useSubscriptionEntries,
} from "@/hooks/useSubscriptions"
import { useIdSelection } from "@/hooks/useIdSelection"
import { formatDuration } from "@/lib/utils"
import { getPageNumbers } from "@/lib/pagination"
import { LinkLibraryItemDialog } from "./LinkLibraryItemDialog"
import type { AddSubscriptionEntryMode, Subscription, SubscriptionEntry } from "@/types/api"

const PAGE_SIZE = 20

interface KnownItemsDialogProps {
  subscription: Subscription
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KnownItemsDialog({ subscription, open, onOpenChange }: KnownItemsDialogProps) {
  const { data: entries, isLoading } = useSubscriptionEntries(subscription.id, open)
  const bulkAdd = useBulkAddSubscriptionEntries()
  const bulkMarkSeen = useBulkMarkSubscriptionEntriesSeen()
  const bulkUnlink = useBulkUnlinkSubscriptionEntries()
  const { selected, isSelected, toggle, clear, selectAll, selectOnly } = useIdSelection<string>()
  const [page, setPage] = useState(1)
  // The single entry the "Link to library item…" picker is open for — null
  // means closed. Link is inherently single-target (there's no sensible
  // library item to bulk-link a whole selection to), unlike every other
  // toolbar action here.
  const [linkEntry, setLinkEntry] = useState<SubscriptionEntry | null>(null)

  // Drag-to-select: mousedown on a row starts the drag and anchors the
  // range; mouseenter on subsequent rows while the button is held extends
  // the selection to every row between the anchor and the row under the
  // cursor. A window-level mouseup ends the drag even if the button is
  // released outside the table. Mirrors TagsPage's own implementation.
  const [isDragging, setIsDragging] = useState(false)
  const dragAnchorIdRef = useRef<string | null>(null)
  // Distinguishes which of the two bulkAdd actions ("ghost"/"download") is
  // in flight, since both share the one mutation object — its own isPending
  // alone can't tell the two buttons apart.
  const [pendingMode, setPendingMode] = useState<AddSubscriptionEntryMode | null>(null)
  // Set while the "N already in your library" confirmation is open — null
  // means no confirmation is pending, so a selection with no duplicates in
  // it skips the dialog entirely and adds immediately.
  const [confirmMode, setConfirmMode] = useState<AddSubscriptionEntryMode | null>(null)

  // The dialog stays mounted across opens (see SubscriptionsPage), and
  // subscription itself can change between opens too — never carry a
  // selection or page position over to a different open/subscription.
  useEffect(() => {
    clear()
    setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subscription.id])

  const total = entries?.length ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageData = (entries ?? []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  // Scoped to the page currently on screen, same as Downloads/Subscriptions
  // — a stale selection from a page no longer visible shouldn't silently
  // ride along into a bulk action.
  useEffect(() => {
    clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  useEffect(() => {
    if (!isDragging) return
    const onMouseUp = () => setIsDragging(false)
    window.addEventListener("mouseup", onMouseUp)
    return () => window.removeEventListener("mouseup", onMouseUp)
  }, [isDragging])

  const isCheckboxTarget = (e: React.MouseEvent) => (e.target as HTMLElement).closest('[role="checkbox"]') != null

  const rangeIds = (anchorId: string, targetId: string) => {
    const anchorIdx = pageData.findIndex((en) => en.sourceId === anchorId)
    const targetIdx = pageData.findIndex((en) => en.sourceId === targetId)
    if (anchorIdx === -1 || targetIdx === -1) return null
    const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    return pageData.slice(start, end + 1).map((en) => en.sourceId)
  }

  // Plain click (no drag) selects only this row, deselecting everything
  // else. Ctrl/Cmd+click toggles just this row in or out of the current
  // selection, and Shift+click selects the range from the last-clicked row
  // to this one — same conventions as TagsPage/DownloadsPage. The checkbox
  // is the one exception, it keeps its own toggle-without-clearing behavior.
  const handleRowMouseDown = (e: React.MouseEvent, sourceId: string) => {
    if (e.button !== 0 || isCheckboxTarget(e)) return
    e.preventDefault()

    if (e.shiftKey && dragAnchorIdRef.current != null) {
      const ids = rangeIds(dragAnchorIdRef.current, sourceId)
      if (ids) {
        selectAll(ids)
        return
      }
    }

    if (e.ctrlKey || e.metaKey) {
      toggle(sourceId)
      dragAnchorIdRef.current = sourceId
      return
    }

    dragAnchorIdRef.current = sourceId
    setIsDragging(true)
    selectOnly(sourceId)
  }

  const handleRowMouseEnter = (sourceId: string) => {
    if (!isDragging || dragAnchorIdRef.current == null) return
    const ids = rangeIds(dragAnchorIdRef.current, sourceId)
    if (ids) selectAll(ids)
  }

  const selectedEntries = (entries ?? []).filter((e) => selected.has(e.sourceId))
  // "Add as ghost"/"Queue download" only need a url to act on — an entry
  // already in the library is still allowed through (see confirmMode
  // below), it just gets a confirmation first instead of silently being
  // excluded.
  const eligibleForAdd = selectedEntries.filter((e) => e.url !== "")
  const eligibleForMarkSeen = selectedEntries.filter((e) => e.seenAt == null)
  const alreadyInLibrary = eligibleForAdd.filter((e) => e.linkedLibraryItemId != null)
  const eligibleForUnlink = selectedEntries.filter((e) => e.libraryItemId != null)

  const doBulkAdd = (mode: AddSubscriptionEntryMode) => {
    const sourceIds = eligibleForAdd.map((e) => e.sourceId)
    if (sourceIds.length === 0) return
    setPendingMode(mode)
    bulkAdd.mutate(
      { subscriptionId: subscription.id, sourceIds, mode },
      { onSuccess: clear, onSettled: () => setPendingMode(null) },
    )
  }

  const handleBulkAdd = (mode: AddSubscriptionEntryMode) => {
    if (eligibleForAdd.length === 0) return
    if (alreadyInLibrary.length > 0) {
      setConfirmMode(mode)
      return
    }
    doBulkAdd(mode)
  }

  const handleBulkMarkSeen = () => {
    const sourceIds = eligibleForMarkSeen.map((e) => e.sourceId)
    if (sourceIds.length === 0) return
    bulkMarkSeen.mutate({ subscriptionId: subscription.id, sourceIds }, { onSuccess: clear })
  }

  const handleBulkUnlink = () => {
    const sourceIds = eligibleForUnlink.map((e) => e.sourceId)
    if (sourceIds.length === 0) return
    bulkUnlink.mutate({ subscriptionId: subscription.id, sourceIds }, { onSuccess: clear })
  }

  const allSelected = pageData.length > 0 && pageData.every((e) => isSelected(e.sourceId))
  const someSelected = pageData.some((e) => isSelected(e.sourceId)) && !allSelected

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[80vw] min-w-0">
        <DialogHeader className="min-w-0">
          <DialogTitle className="truncate">Known items — {subscription.title}</DialogTitle>
          <DialogDescription>
            Every video Packrat has ever seen from this subscription. Select rows and add them
            manually as ghost items or queued downloads.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={eligibleForAdd.length === 0 || bulkAdd.isPending}
              onClick={() => handleBulkAdd("ghost")}
            >
              <Ghost className="h-4 w-4" />
              {bulkAdd.isPending && pendingMode === "ghost" ? "Adding…" : "Add as ghost"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={eligibleForAdd.length === 0 || bulkAdd.isPending}
              onClick={() => handleBulkAdd("download")}
            >
              <Download className="h-4 w-4" />
              {bulkAdd.isPending && pendingMode === "download" ? "Queuing…" : "Queue download"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={eligibleForMarkSeen.length === 0 || bulkMarkSeen.isPending}
              onClick={handleBulkMarkSeen}
            >
              <Eye className="h-4 w-4" />
              {bulkMarkSeen.isPending ? "Marking…" : "Mark seen"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={selectedEntries.length !== 1}
              onClick={() => setLinkEntry(selectedEntries[0] ?? null)}
            >
              <Link2 className="h-4 w-4" />
              Link to library item…
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={eligibleForUnlink.length === 0 || bulkUnlink.isPending}
              onClick={handleBulkUnlink}
            >
              <Link2Off className="h-4 w-4" />
              {bulkUnlink.isPending ? "Unlinking…" : "Unlink"}
            </Button>
          </div>
          <span className="text-sm text-muted-foreground">
            {selected.size > 0 ? `${selected.size} selected` : "Nothing selected"}
          </span>
        </div>

        <AlertDialog open={confirmMode != null} onOpenChange={(next) => !next && setConfirmMode(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {alreadyInLibrary.length} of {eligibleForAdd.length} selected item
                {eligibleForAdd.length === 1 ? "" : "s"} already in your library
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmMode === "ghost"
                  ? "Add another ghost placeholder for them anyway? This creates a second entry alongside the existing one."
                  : "Queue another download for them anyway? This creates a new library entry — it won't touch the existing one."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (confirmMode) doBulkAdd(confirmMode)
                  setConfirmMode(null)
                }}
              >
                {confirmMode === "ghost" ? "Add as ghost" : "Queue download"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <LinkLibraryItemDialog
          subscriptionId={subscription.id}
          entry={linkEntry}
          onOpenChange={(next) => !next && setLinkEntry(null)}
        />

        {/* Fixed height (not max-height) so the dialog doesn't resize as
            pages/loading states change, plus a single scroll container via
            Table's own containerClassName — a second overflow-y-auto
            wrapper around Table would break TableHeader's sticky
            positioning (see Table's doc comment in components/ui/table.tsx),
            same reasoning TagsPage's table already follows. */}
        <div className="h-[60vh] overflow-hidden rounded-md border">
          {isLoading ? (
            <div className="h-full space-y-1 overflow-y-auto p-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : !entries || entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No known items yet.</p>
          ) : (
            <Table containerClassName="h-full overflow-auto">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={(checked) =>
                        checked ? selectAll(pageData.map((e) => e.sourceId)) : clear()
                      }
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>First seen</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageData.map((entry) => {
                  const isKnownEntry = entry.url !== ""
                  const isUnseen = entry.seenAt == null && isKnownEntry
                  return (
                    <TableRow
                      key={entry.sourceId}
                      data-source-id={entry.sourceId}
                      data-state={isSelected(entry.sourceId) ? "selected" : undefined}
                      className="cursor-default select-none"
                      onMouseDown={(e) => handleRowMouseDown(e, entry.sourceId)}
                      onMouseEnter={() => handleRowMouseEnter(entry.sourceId)}
                    >
                      <TableCell>
                        <Checkbox
                          checked={isSelected(entry.sourceId)}
                          onCheckedChange={() => toggle(entry.sourceId)}
                          aria-label={`Select ${isKnownEntry ? entry.title : "entry"}`}
                        />
                      </TableCell>
                      <TableCell className="max-w-[360px] truncate font-medium">
                        {isKnownEntry ? entry.title : "Unknown"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDuration(entry.durationSeconds)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(entry.firstSeenAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {entry.linkedLibraryItemId != null ? (
                          <Badge variant="secondary">
                            {entry.linkedLibraryItemIsGhost ? "In library (ghost)" : "In library"}
                          </Badge>
                        ) : !isKnownEntry ? (
                          <span className="text-xs text-muted-foreground">No details recorded</span>
                        ) : isUnseen ? (
                          <Badge variant="secondary">New</Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {!isLoading && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {total} item{total === 1 ? "" : "s"}
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
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

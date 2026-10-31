import { useEffect, useState } from "react"
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table"
import type { ColumnDef } from "@/components/data-table"
import {
  useBulkAddSubscriptionEntries,
  useBulkMarkSubscriptionEntriesSeen,
  useBulkUnlinkSubscriptionEntries,
  useSubscriptionEntries,
} from "@/hooks/useSubscriptions"
import { useIdSelection } from "@/hooks/useIdSelection"
import { formatDuration } from "@/lib/utils"
import { LinkLibraryItemDialog } from "./LinkLibraryItemDialog"
import type { AddSubscriptionEntryMode, Subscription, SubscriptionEntry } from "@/types/api"

const PAGE_SIZE = 20
const ITEM_LABEL = { singular: "item", plural: "items" }

const getEntryId = (e: SubscriptionEntry) => e.sourceId
const getEntryLabel = (e: SubscriptionEntry) => `Select ${e.url !== "" ? e.title : "entry"}`

const columns: ColumnDef<SubscriptionEntry>[] = [
  {
    key: "title",
    header: "Title",
    cellClassName: "max-w-[360px] truncate font-medium",
    cell: (entry) => (entry.url !== "" ? entry.title : "Unknown"),
  },
  {
    key: "duration",
    header: "Duration",
    type: "number",
    cellClassName: "text-muted-foreground",
    cell: (entry) => formatDuration(entry.durationSeconds),
  },
  {
    key: "firstSeen",
    header: "First seen",
    type: "date",
    cellClassName: "text-muted-foreground",
    cell: (entry) => new Date(entry.firstSeenAt).toLocaleDateString(),
  },
  {
    key: "status",
    header: "Status",
    type: "status",
    cell: (entry) => {
      const isKnownEntry = entry.url !== ""
      return entry.linkedLibraryItemId != null ? (
        <Badge variant="secondary">{entry.linkedLibraryItemIsGhost ? "In library (ghost)" : "In library"}</Badge>
      ) : !isKnownEntry ? (
        <span className="text-xs text-muted-foreground">No details recorded</span>
      ) : entry.seenAt == null ? (
        <Badge variant="secondary">New</Badge>
      ) : null
    },
  },
]

const loadingContent = (
  <div className="h-full space-y-1 overflow-y-auto p-2">
    {Array.from({ length: 4 }).map((_, i) => (
      <Skeleton key={i} className="h-10 w-full rounded-md" />
    ))}
  </div>
)

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
  const selection = useIdSelection<string>()
  const { selected, clear } = selection
  // The single entry the "Link to library item…" picker is open for — null
  // means closed. Link is inherently single-target (there's no sensible
  // library item to bulk-link a whole selection to), unlike every other
  // toolbar action here.
  const [linkEntry, setLinkEntry] = useState<SubscriptionEntry | null>(null)

  // Distinguishes which of the two bulkAdd actions ("ghost"/"download") is
  // in flight, since both share the one mutation object — its own isPending
  // alone can't tell the two buttons apart.
  const [pendingMode, setPendingMode] = useState<AddSubscriptionEntryMode | null>(null)
  // Set while the "N already in your library" confirmation is open — null
  // means no confirmation is pending, so a selection with no duplicates in
  // it skips the dialog entirely and adds immediately.
  const [confirmMode, setConfirmMode] = useState<AddSubscriptionEntryMode | null>(null)

  // The dialog stays mounted across opens (see SubscriptionsPage), and subscription itself can change between
  // opens too — never carry a selection over to a different open/subscription. The table resets its own page
  // (its content unmounts when the dialog closes, and resetKey covers a subscription change); the selection lives
  // here, so it is cleared here.
  useEffect(() => {
    clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subscription.id])

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

        <DataTable
          className="gap-4"
          rows={entries ?? []}
          getRowId={getEntryId}
          columns={columns}
          selection="multi"
          selectionState={selection}
          getRowLabel={getEntryLabel}
          pageSize={PAGE_SIZE}
          itemLabel={ITEM_LABEL}
          resetKey={subscription.id}
          loading={isLoading}
          loadingContent={loadingContent}
          empty={<p className="px-3 py-6 text-center text-sm text-muted-foreground">No known items yet.</p>}
          // Fixed height (not max-height) so the dialog does not resize as pages / loading states change, and one
          // scroll container (the table's own) so the sticky header keeps working.
          regionClassName="h-[60vh] flex-none overflow-hidden rounded-md border"
          containerClassName="h-full overflow-auto"
          toolbar={
            <>
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
            </>
          }
        />

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
      </DialogContent>
    </Dialog>
  )
}

import { useState } from "react"
import { History, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AddSubscriptionDialog } from "@/components/subscriptions/AddSubscriptionDialog"
import { EditSubscriptionDialog } from "@/components/subscriptions/EditSubscriptionDialog"
import { KnownItemsDialog } from "@/components/subscriptions/KnownItemsDialog"
import { cn } from "@/lib/utils"
import { useCheckSubscriptionNow, useDeleteSubscription, useSubscriptions, useUpdateSubscription } from "@/hooks/useSubscriptions"
import type { Subscription } from "@/types/api"

export function SubscriptionsPage() {
  const { data: subscriptions, isLoading } = useSubscriptions()
  const updateSubscription = useUpdateSubscription()
  const deleteSubscription = useDeleteSubscription()
  const checkNow = useCheckSubscriptionNow()

  const [addOpen, setAddOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editTarget, setEditTarget] = useState<Subscription | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Subscription | null>(null)
  const [knownItemsTarget, setKnownItemsTarget] = useState<Subscription | null>(null)

  const selected = subscriptions?.find((s) => s.id === selectedId) ?? null

  const toggleEnabled = (sub: Subscription, enabled: boolean) => {
    updateSubscription.mutate({
      id: sub.id,
      payload: {
        collectionId: sub.collectionId ?? undefined,
        tags: sub.tags,
        autoDownload: sub.autoDownload,
        generateNfo: sub.generateNfo,
        checkIntervalHours: sub.checkIntervalHours,
        enabled,
      },
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">
            Channels and playlists Packrat periodically checks for new uploads.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          Add subscription
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </div>
      ) : !subscriptions || subscriptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet — add a channel or playlist URL to get notified about new uploads.
        </p>
      ) : (
        <>
          {/* Always visible — buttons just disable when nothing's selected,
              rather than the toolbar itself appearing/disappearing. Select
              a row's checkbox below to enable them; only one row at a time
              since Edit only ever targets one subscription. */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-none border-r"
                disabled={!selected}
                onClick={() => selected && setEditTarget(selected)}
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-none text-destructive hover:text-destructive"
                disabled={!selected}
                onClick={() => selected && setDeleteTarget(selected)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
            <Button
              size="sm"
              disabled={!selected || checkNow.isPending}
              onClick={() => selected && checkNow.mutate(selected.id)}
            >
              <RefreshCw className="h-4 w-4" />
              {checkNow.isPending ? "Checking…" : "Check now"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!selected}
              onClick={() => selected && setKnownItemsTarget(selected)}
            >
              <History className="h-4 w-4" />
              Known items
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Title</TableHead>
                <TableHead>Collection</TableHead>
                <TableHead>Known items</TableHead>
                <TableHead>Last checked</TableHead>
                <TableHead>Auto-download</TableHead>
                <TableHead>Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.map((sub) => (
                <TableRow
                  key={sub.id}
                  className={cn("cursor-pointer", sub.id === selectedId && "bg-muted/50")}
                  onClick={() => setSelectedId(sub.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={sub.id === selectedId}
                      onCheckedChange={(v) => setSelectedId(v ? sub.id : null)}
                      aria-label="Select"
                    />
                  </TableCell>
                  <TableCell className="max-w-64">
                    <p className="truncate font-medium">{sub.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{sub.url}</p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{sub.collectionName ?? "Uncategorized"}</TableCell>
                  <TableCell className="text-sm">{sub.knownEntryCount}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {sub.lastCheckedAt ? new Date(sub.lastCheckedAt).toLocaleString() : "Never"}
                  </TableCell>
                  <TableCell>
                    {sub.autoDownload ? <Badge variant="secondary">On</Badge> : <span className="text-sm text-muted-foreground">Off</span>}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Switch checked={sub.enabled} onCheckedChange={(v) => toggleEnabled(sub, v)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      <AddSubscriptionDialog open={addOpen} onOpenChange={setAddOpen} />
      {editTarget && (
        <EditSubscriptionDialog
          subscription={editTarget}
          open={editTarget != null}
          onOpenChange={(open) => !open && setEditTarget(null)}
        />
      )}

      {knownItemsTarget && (
        <KnownItemsDialog
          subscription={knownItemsTarget}
          open={knownItemsTarget != null}
          onOpenChange={(open) => !open && setKnownItemsTarget(null)}
        />
      )}

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              Stops checking "{deleteTarget?.title}" for new uploads. Items it already created stay
              in your library — this only removes the subscription itself.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deleteSubscription.mutate(deleteTarget.id)
                setDeleteTarget(null)
                setSelectedId(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

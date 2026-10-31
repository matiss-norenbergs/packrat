import { useCallback, useMemo, useState } from "react"
import { AlertTriangle, History, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { DataTable } from "@/components/data-table"
import type { ColumnDef, ContextMenuItemDef } from "@/components/data-table"
import { AddSubscriptionDialog } from "@/components/subscriptions/AddSubscriptionDialog"
import { EditSubscriptionDialog } from "@/components/subscriptions/EditSubscriptionDialog"
import { KnownItemsDialog } from "@/components/subscriptions/KnownItemsDialog"
import { useIdSelection } from "@/hooks/useIdSelection"
import {
  useBulkCheckSubscriptionsNow,
  useBulkDeleteSubscriptions,
  useCheckSubscriptionNow,
  useSubscriptions,
  useUpdateSubscription,
} from "@/hooks/useSubscriptions"
import type { Subscription } from "@/types/api"

const PAGE_SIZE = 50

const matchSubscription = (s: Subscription, q: string) =>
  s.title.toLowerCase().includes(q) || s.url.toLowerCase().includes(q)

// Mirrors CollectionFolderTile's gap-warning popover (same controlled-hover
// pattern, same amber styling) for a subscription's last check failure.
function LastCheckErrorBadge({ error }: { error: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-amber-600 dark:text-amber-500"
          aria-label="Last check failed"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="text-xs text-muted-foreground" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        {error}
      </PopoverContent>
    </Popover>
  )
}

export function SubscriptionsPage() {
  const { data, isLoading, isError, error } = useSubscriptions()
  const selection = useIdSelection()
  const { selected, clear, size, active } = selection
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [knownItemsOpen, setKnownItemsOpen] = useState(false)
  const { mutate: updateSubscription } = useUpdateSubscription()
  const bulkDelete = useBulkDeleteSubscriptions()
  const checkNow = useCheckSubscriptionNow()
  const bulkCheckNow = useBulkCheckSubscriptionsNow()

  const target = size === 1 ? data?.find((s) => selected.has(s.id)) : undefined

  // The Enabled cell closes over this and `columns` is memoized on it. `mutate` keeps its identity across
  // renders (TanStack Query v5 wraps it in useCallback over the observer), so the columns only rebuild if
  // that ever changes — and then they pick up the new one rather than a stale mutation.
  const toggleEnabled = useCallback(
    (sub: Subscription, enabled: boolean) => {
      updateSubscription({
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
    },
    [updateSubscription],
  )

  const columns = useMemo<ColumnDef<Subscription>[]>(
    () => [
      {
        key: "title",
        header: "Title",
        width: 300,
        flex: true,
        sortValue: (sub) => sub.title,
        cell: (sub) => (
          <>
            <p className="truncate font-medium">{sub.title}</p>
            <p className="truncate text-xs text-muted-foreground">{sub.url}</p>
          </>
        ),
      },
      {
        key: "collection",
        header: "Collection",
        hideable: true,
        cellClassName: "text-sm text-muted-foreground",
        sortValue: (sub) => sub.collectionName ?? "Uncategorized",
        cell: (sub) => sub.collectionName ?? "Uncategorized",
      },
      {
        key: "knownItems",
        header: "Known items",
        hideable: true,
        type: "number",
        width: 140,
        cellClassName: "text-sm",
        sortValue: (sub) => sub.knownEntryCount,
        cell: (sub) => (
          <span className="flex items-center justify-end gap-1.5">
            {sub.knownEntryCount}
            {sub.unseenEntryCount > 0 && <Badge variant="secondary">+{sub.unseenEntryCount} new</Badge>}
          </span>
        ),
      },
      {
        key: "lastChecked",
        header: "Last checked",
        hideable: true,
        type: "date",
        width: 210,
        cellClassName: "text-sm text-muted-foreground",
        sortValue: (sub) => (sub.lastCheckedAt ? new Date(sub.lastCheckedAt) : null),
        cell: (sub) => (
          <div className="flex items-center justify-center gap-1.5">
            {sub.lastCheckedAt ? new Date(sub.lastCheckedAt).toLocaleString() : "Never"}
            {sub.lastCheckError && <LastCheckErrorBadge error={sub.lastCheckError} />}
          </div>
        ),
      },
      {
        key: "autoDownload",
        header: "Auto-download",
        hideable: true,
        type: "status",
        cell: (sub) =>
          sub.autoDownload ? <Badge variant="secondary">On</Badge> : <span className="text-sm text-muted-foreground">Off</span>,
      },
      {
        key: "enabled",
        header: "Enabled",
        type: "switch",
        cell: (sub) => <Switch checked={sub.enabled} onCheckedChange={(v) => toggleEnabled(sub, v)} />,
      },
    ],
    [toggleEnabled],
  )

  // Single selection keeps its own hook (a more specific "Found N" /
  // "Up to date" toast per subscription); multiple selected fires the
  // per-id check concurrently for each one instead.
  const checkNowPending = checkNow.isPending || bulkCheckNow.isPending
  const handleCheckNow = () => {
    if (size === 1 && target) checkNow.mutate(target.id)
    else if (active) bulkCheckNow.mutate(Array.from(selected))
  }

  const contextMenu = (rows: Subscription[]): ContextMenuItemDef<Subscription>[] => [
    { key: "add", label: "Add subscription", icon: <Plus className="h-4 w-4" />, onSelect: () => setAddOpen(true) },
    { key: "edit", label: "Edit", icon: <Pencil className="h-4 w-4" />, disabled: rows.length !== 1, onSelect: () => setEditOpen(true) },
    {
      key: "check",
      label: `Check now${rows.length > 1 ? ` (${rows.length})` : ""}`,
      icon: <RefreshCw className="h-4 w-4" />,
      disabled: rows.length === 0 || checkNowPending,
      onSelect: handleCheckNow,
    },
    {
      key: "known",
      label: "Known items",
      icon: <History className="h-4 w-4" />,
      disabled: rows.length !== 1,
      onSelect: () => setKnownItemsOpen(true),
    },
    {
      key: "delete",
      label: `Delete${rows.length > 1 ? ` (${rows.length})` : ""}`,
      icon: <Trash2 className="h-4 w-4" />,
      destructive: true,
      disabled: rows.length === 0,
      onSelect: () => setDeleteOpen(true),
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <h1 className="shrink-0 text-2xl font-semibold">Subscriptions</h1>

      <DataTable
        rows={data ?? []}
        getRowId={(s) => s.id}
        columns={columns}
        tableId="subscriptions"
        selection="multi"
        selectionState={selection}
        getRowLabel={(s) => `Select ${s.title}`}
        loading={isLoading}
        error={
          isError ? <p className="text-sm text-destructive">Failed to load subscriptions: {(error as Error).message}</p> : undefined
        }
        empty={(query) =>
          !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing here yet — add a channel or playlist URL to get notified about new uploads.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No subscriptions match "{query}".</p>
          )
        }
        search={{ match: matchSubscription, placeholder: "Search subscriptions…" }}
        pageSize={PAGE_SIZE}
        itemLabel={{ singular: "subscription", plural: "subscriptions" }}
        contextMenu={contextMenu}
        toolbar={
          <>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add subscription
            </Button>
            <AddSubscriptionDialog open={addOpen} onOpenChange={setAddOpen} />

            <Button variant="outline" size="sm" disabled={size !== 1} onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            {target && <EditSubscriptionDialog subscription={target} open={editOpen} onOpenChange={setEditOpen} />}

            <Button variant="destructive" size="sm" disabled={!active} onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {size} selected subscription{size === 1 ? "" : "s"}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Stops checking for new uploads. Items already created stay in your library — this
                    only removes the subscription{size === 1 ? "" : "s"} themselves.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      bulkDelete.mutate(Array.from(selected), {
                        onSuccess: () => {
                          clear()
                          setDeleteOpen(false)
                        },
                      })
                    }
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button variant="outline" size="sm" disabled={!active || checkNowPending} onClick={handleCheckNow}>
              <RefreshCw className="h-4 w-4" />
              {checkNowPending ? "Checking…" : "Check now"}
            </Button>

            <Button variant="outline" size="sm" disabled={size !== 1} onClick={() => setKnownItemsOpen(true)}>
              <History className="h-4 w-4" />
              Known items
            </Button>
            {target && <KnownItemsDialog subscription={target} open={knownItemsOpen} onOpenChange={setKnownItemsOpen} />}
          </>
        }
      />
    </div>
  )
}

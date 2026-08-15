import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, History, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
import { getPageNumbers } from "@/lib/pagination"
import type { Subscription } from "@/types/api"

const PAGE_SIZE = 50

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
  const { selected, isSelected, toggle, clear, selectAll, selectOnly, size, active } = useIdSelection()
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [knownItemsOpen, setKnownItemsOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const updateSubscription = useUpdateSubscription()
  const bulkDelete = useBulkDeleteSubscriptions()
  const checkNow = useCheckSubscriptionNow()
  const bulkCheckNow = useBulkCheckSubscriptionsNow()

  // Drag-to-select: mousedown on a row starts the drag and anchors the
  // range; mouseenter on subsequent rows while the button is held extends
  // the selection to every row between the anchor and the row under the
  // cursor. A window-level mouseup ends the drag even if the button is
  // released outside the table.
  const [isDragging, setIsDragging] = useState(false)
  const dragAnchorIdRef = useRef<number | null>(null)

  // Radix's ContextMenu only computes the floating menu's position when its
  // content actually (re)mounts — keying on this counter forces a fresh
  // remeasure on every right-click, matching Tags/Artists/History.
  const [contextMenuAnchorKey, setContextMenuAnchorKey] = useState(0)

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(id)
  }, [searchInput])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data ?? []
    return (data ?? []).filter((s) => s.title.toLowerCase().includes(q) || s.url.toLowerCase().includes(q))
  }, [data, search])
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const allSelected = pageData.length > 0 && pageData.every((s) => selected.has(s.id))
  const someSelected = pageData.some((s) => selected.has(s.id)) && !allSelected
  const target = size === 1 ? data?.find((s) => selected.has(s.id)) : undefined

  useEffect(() => {
    clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search])

  useEffect(() => {
    setPage(1)
  }, [search])

  useEffect(() => {
    if (!isDragging) return
    const onMouseUp = () => setIsDragging(false)
    window.addEventListener("mouseup", onMouseUp)
    return () => window.removeEventListener("mouseup", onMouseUp)
  }, [isDragging])

  // Excludes the row's checkbox and the per-row switch/error-popover
  // controls — those keep their own click behavior instead of driving
  // selection.
  const isInteractiveTarget = (e: React.MouseEvent) =>
    (e.target as HTMLElement).closest('[role="checkbox"], [role="switch"], button') != null

  const rangeIds = (anchorId: number, targetId: number) => {
    const anchorIdx = pageData.findIndex((s) => s.id === anchorId)
    const targetIdx = pageData.findIndex((s) => s.id === targetId)
    if (anchorIdx === -1 || targetIdx === -1) return null
    const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    return pageData.slice(start, end + 1).map((s) => s.id)
  }

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

  const handleTableContextMenu = (e: React.MouseEvent) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>("tr[data-subscription-id]")
    if (!rowEl) {
      e.preventDefault()
      return
    }
    const id = Number(rowEl.dataset.subscriptionId)
    if (!selected.has(id)) selectOnly(id)
    setContextMenuAnchorKey((k) => k + 1)
  }

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

  // Single selection keeps its own hook (a more specific "Found N" /
  // "Up to date" toast per subscription); multiple selected fires the
  // per-id check concurrently for each one instead.
  const checkNowPending = checkNow.isPending || bulkCheckNow.isPending
  const handleCheckNow = () => {
    if (size === 1 && target) checkNow.mutate(target.id)
    else if (active) bulkCheckNow.mutate(Array.from(selected))
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <h1 className="shrink-0 text-2xl font-semibold">Subscriptions</h1>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
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
        {target && (
          <KnownItemsDialog subscription={target} open={knownItemsOpen} onOpenChange={setKnownItemsOpen} />
        )}

        <div className="relative ml-auto min-w-[160px] max-w-[280px] flex-1 sm:min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search subscriptions…"
            className="pl-8 pr-7"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearchInput("")
                setSearch("")
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Failed to load subscriptions: {(error as Error).message}</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing here yet — add a channel or playlist URL to get notified about new uploads.
          </p>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground">No subscriptions match "{search}".</p>
        ) : (
          <ContextMenu>
            <ContextMenuTrigger asChild onContextMenu={handleTableContextMenu}>
              {/* Single scroll container (both axes) via containerClassName — see
                  Table's doc comment in components/ui/table.tsx for why a second
                  overflow-y-auto wrapper would break the header's sticky positioning. */}
              <Table containerClassName="h-full overflow-auto rounded-md border">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        onCheckedChange={(checked) => (checked ? selectAll(pageData.map((s) => s.id)) : clear())}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Collection</TableHead>
                    <TableHead>Known items</TableHead>
                    <TableHead>Last checked</TableHead>
                    <TableHead>Auto-download</TableHead>
                    <TableHead>Enabled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageData.map((sub) => (
                    <TableRow
                      key={sub.id}
                      data-subscription-id={sub.id}
                      data-state={isSelected(sub.id) ? "selected" : undefined}
                      className="cursor-default select-none"
                      onMouseDown={(e) => handleRowMouseDown(e, sub.id)}
                      onMouseEnter={() => handleRowMouseEnter(sub.id)}
                    >
                      <TableCell>
                        <Checkbox
                          checked={isSelected(sub.id)}
                          onCheckedChange={() => toggle(sub.id)}
                          aria-label={`Select ${sub.title}`}
                        />
                      </TableCell>
                      <TableCell className="max-w-64">
                        <p className="truncate font-medium">{sub.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{sub.url}</p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{sub.collectionName ?? "Uncategorized"}</TableCell>
                      <TableCell className="text-sm">
                        <span className="flex items-center gap-1.5">
                          {sub.knownEntryCount}
                          {sub.unseenEntryCount > 0 && <Badge variant="secondary">+{sub.unseenEntryCount} new</Badge>}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          {sub.lastCheckedAt ? new Date(sub.lastCheckedAt).toLocaleString() : "Never"}
                          {sub.lastCheckError && <LastCheckErrorBadge error={sub.lastCheckError} />}
                        </div>
                      </TableCell>
                      <TableCell>
                        {sub.autoDownload ? <Badge variant="secondary">On</Badge> : <span className="text-sm text-muted-foreground">Off</span>}
                      </TableCell>
                      <TableCell>
                        <Switch checked={sub.enabled} onCheckedChange={(v) => toggleEnabled(sub, v)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ContextMenuTrigger>
            <ContextMenuContent key={contextMenuAnchorKey}>
              <ContextMenuItem onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" />
                Add subscription
              </ContextMenuItem>
              <ContextMenuItem disabled={size !== 1} onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </ContextMenuItem>
              <ContextMenuItem disabled={!active || checkNowPending} onClick={handleCheckNow}>
                <RefreshCw className="h-4 w-4" />
                Check now{size > 1 ? ` (${size})` : ""}
              </ContextMenuItem>
              <ContextMenuItem disabled={size !== 1} onClick={() => setKnownItemsOpen(true)}>
                <History className="h-4 w-4" />
                Known items
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" disabled={!active} onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" />
                Delete{size > 1 ? ` (${size})` : ""}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
      </div>

      {!isLoading && data && data.length > 0 && total > 0 && (
        <div className="flex shrink-0 items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {total} {total === 1 ? "subscription" : "subscriptions"}
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
    </div>
  )
}

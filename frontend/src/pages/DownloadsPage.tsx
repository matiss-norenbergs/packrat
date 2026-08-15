import { useEffect, useMemo, useRef, useState } from "react"
import { Search, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { BulkDownloadDialog } from "@/components/downloads/BulkDownloadDialog"
import { CANCELLABLE_STATUSES } from "@/components/downloads/DownloadQueueItem"
import { DownloadQueueList } from "@/components/downloads/DownloadQueueList"
import { NewDownloadDialog } from "@/components/downloads/NewDownloadDialog"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useBulkDeleteDownloads, useDownloads } from "@/hooks/useDownloads"
import { getPageNumbers } from "@/lib/pagination"

const PAGE_SIZE = 25

export function DownloadsPage() {
  const { data, isLoading, isError, error } = useDownloads()
  const { selected, isSelected, toggle, clear, selectAll, selectOnly, active } = useIdSelection()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const bulkDeleteDownloads = useBulkDeleteDownloads()

  // Debounce the value actually used for filtering so fast typing doesn't
  // re-filter/re-paginate on every keystroke — the input itself still
  // updates immediately via searchInput.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(id)
  }, [searchInput])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const all = data ?? []
    if (!q) return all
    return all.filter((d) => (d.title ?? d.url).toLowerCase().includes(q))
  }, [data, search])
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Drag-to-select: mousedown on an item starts the drag and anchors the
  // range; mouseenter on subsequent items while the button is held extends
  // the selection to every item between the anchor and the item under the
  // cursor. A window-level mouseup ends the drag even if the button is
  // released outside the list.
  const [isDragging, setIsDragging] = useState(false)
  const dragAnchorIdRef = useRef<number | null>(null)

  // Radix's ContextMenu only computes the floating menu's position when its
  // content actually (re)mounts — keying ContextMenuContent on this counter
  // forces a genuine remount (and fresh position read) on every right-click.
  const [contextMenuAnchorKey, setContextMenuAnchorKey] = useState(0)

  // The selection is scoped to what's currently visible on this page — a
  // stale id from a previous page shouldn't silently ride along once the
  // item it refers to is no longer on screen.
  useEffect(() => {
    clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  // The live poll can shrink the list out from under the current page
  // number (a download finishes and rolls off, etc.) — snap back instead of
  // showing an empty page.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  // A search that shrinks the result set out from under the current page
  // number would otherwise show an empty page instead of snapping back.
  useEffect(() => {
    setPage(1)
  }, [search])

  useEffect(() => {
    if (!isDragging) return
    const onMouseUp = () => setIsDragging(false)
    window.addEventListener("mouseup", onMouseUp)
    return () => window.removeEventListener("mouseup", onMouseUp)
  }, [isDragging])

  // The backend rejects deleting a still-active download (409, "cancel
  // before deleting") — bulk delete only ever acts on the subset of the
  // selection that isn't currently downloading.
  const deletableSelected = Array.from(selected).filter((id) => {
    const d = pageData.find((x) => x.id === id)
    return d != null && !CANCELLABLE_STATUSES.has(d.status)
  })

  const isInteractiveTarget = (e: React.MouseEvent) =>
    (e.target as HTMLElement).closest('[role="checkbox"], button') != null

  const rangeIds = (anchorId: number, targetId: number) => {
    const anchorIdx = pageData.findIndex((d) => d.id === anchorId)
    const targetIdx = pageData.findIndex((d) => d.id === targetId)
    if (anchorIdx === -1 || targetIdx === -1) return null
    const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    return pageData.slice(start, end + 1).map((d) => d.id)
  }

  // Plain click (no drag) selects only this item, deselecting everything
  // else. Ctrl/Cmd+click toggles just this item in or out of the current
  // selection, and Shift+click selects the range from the last-clicked item
  // to this one. The checkbox and the per-item Cancel button are the
  // exceptions — they keep their own click behavior.
  const handleItemMouseDown = (e: React.MouseEvent, id: number) => {
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

  const handleItemMouseEnter = (id: number) => {
    if (!isDragging || dragAnchorIdRef.current == null) return
    const ids = rangeIds(dragAnchorIdRef.current, id)
    if (ids) selectAll(ids)
  }

  const handleListContextMenu = (e: React.MouseEvent) => {
    const itemEl = (e.target as HTMLElement).closest<HTMLElement>("[data-download-id]")
    if (!itemEl) {
      e.preventDefault()
      return
    }
    const id = Number(itemEl.dataset.downloadId)
    if (!selected.has(id)) selectOnly(id)
    setContextMenuAnchorKey((k) => k + 1)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <h1 className="shrink-0 text-2xl font-semibold">Downloads</h1>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex">
          <NewDownloadDialog />
          <BulkDownloadDialog />
        </div>

        <Button
          variant="destructive"
          size="sm"
          disabled={deletableSelected.length === 0}
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Remove {deletableSelected.length} selected download{deletableSelected.length === 1 ? "" : "s"} from
                the list?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Downloaded files aren't affected — only these queue entries are removed. Still-active downloads in
                the selection are skipped; cancel them first.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  bulkDeleteDownloads.mutate(deletableSelected, {
                    onSuccess: () => {
                      clear()
                      setDeleteOpen(false)
                    },
                  })
                }
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {active && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        )}

        <div className="relative ml-auto min-w-[160px] max-w-[280px] flex-1 sm:min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search downloads…"
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ContextMenu>
          <ContextMenuTrigger asChild onContextMenu={handleListContextMenu}>
            <div>
              <DownloadQueueList
                downloads={pageData}
                isLoading={isLoading}
                isError={isError}
                error={error}
                isEmpty={(data ?? []).length === 0}
                isSelected={isSelected}
                onToggle={toggle}
                onItemMouseDown={handleItemMouseDown}
                onItemMouseEnter={handleItemMouseEnter}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent key={contextMenuAnchorKey}>
            <ContextMenuItem
              variant="destructive"
              disabled={deletableSelected.length === 0}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              Delete{deletableSelected.length > 1 ? ` (${deletableSelected.length})` : ""}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>

      {!isLoading && total > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {total} {total === 1 ? "download" : "downloads"}
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

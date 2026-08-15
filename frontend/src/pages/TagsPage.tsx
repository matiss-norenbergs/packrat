import { useEffect, useMemo, useRef, useState } from "react"
import { Lock, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TagDialog } from "@/components/tags/TagDialog"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useSettings } from "@/hooks/useSettings"
import { useBulkDeleteTags, useTags } from "@/hooks/useTags"
import { getPageNumbers } from "@/lib/pagination"
import type { Tag } from "@/types/api"

const PAGE_SIZE = 50

export function TagsPage() {
  const { data: settings } = useSettings()
  const { data, isLoading, isError, error } = useTags()
  const { selected, isSelected, toggle, clear, selectAll, selectOnly, size, active } = useIdSelection()
  const [newTagOpen, setNewTagOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const bulkDeleteTags = useBulkDeleteTags()

  // Drag-to-select: mousedown on a row starts the drag and anchors the
  // range; mouseenter on subsequent rows while the button is held extends
  // the selection to every row between the anchor and the row under the
  // cursor. A window-level mouseup ends the drag even if the button is
  // released outside the table.
  const [isDragging, setIsDragging] = useState(false)
  const dragAnchorIdRef = useRef<number | null>(null)

  // Radix's ContextMenu only computes the floating menu's position when
  // its content actually (re)mounts — while it's already open, Presence
  // treats a same-tick open→open toggle as "still mounted" and skips
  // remeasuring, so right-clicking a second row would otherwise leave the
  // menu stuck at the first row's position. Keying ContextMenuContent on
  // this counter forces a genuine remount (and fresh position read) on
  // every right-click, regardless of whether the menu was already open.
  const [contextMenuAnchorKey, setContextMenuAnchorKey] = useState(0)

  // Debounce the value actually used for filtering so fast typing doesn't
  // re-filter/re-paginate on every keystroke — the input itself still
  // updates immediately via searchInput.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(id)
  }, [searchInput])

  const privacyEnabled = !!settings?.privacyEnabled
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data ?? []
    return (data ?? []).filter((t) => t.name.toLowerCase().includes(q))
  }, [data, search])
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const allSelected = pageData.length > 0 && pageData.every((t) => selected.has(t.id))
  const someSelected = pageData.some((t) => selected.has(t.id)) && !allSelected
  const editTarget = size === 1 ? data?.find((t) => selected.has(t.id)) : undefined

  // The selection is scoped to what's currently visible on this page — a
  // stale id from a previous page/search shouldn't silently ride along once
  // the rows it referred to are no longer on screen.
  useEffect(() => {
    clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search])

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

  const isCheckboxTarget = (e: React.MouseEvent) => (e.target as HTMLElement).closest('[role="checkbox"]') != null

  const rangeIds = (anchorId: number, targetId: number) => {
    const anchorIdx = pageData.findIndex((t) => t.id === anchorId)
    const targetIdx = pageData.findIndex((t) => t.id === targetId)
    if (anchorIdx === -1 || targetIdx === -1) return null
    const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    return pageData.slice(start, end + 1).map((t) => t.id)
  }

  // Plain click (no drag) selects only this row, deselecting everything
  // else. Ctrl/Cmd+click toggles just this row in or out of the current
  // selection (for non-contiguous multi-select), and Shift+click selects
  // the range from the last-clicked row to this one — the same two
  // conventions file managers and mail clients use. The checkbox is the
  // one exception to all of this, it keeps its own toggle-without-clearing
  // behavior via onSelectedChange below.
  const handleRowMouseDown = (e: React.MouseEvent, id: number) => {
    if (e.button !== 0 || isCheckboxTarget(e)) return
    e.preventDefault() // avoid native text-selection while dragging/shift-clicking

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
  // a row that's already selected leaves a multi-selection intact so the
  // menu's Delete acts on the whole group. Right-clicking the header (no
  // data-tag-id ancestor) isn't a row action, so it shouldn't open a menu
  // at all — calling preventDefault skips Radix's own reopen handler too
  // (composeEventHandlers checks event.defaultPrevented), the same escape
  // hatch it already uses to suppress the native browser menu.
  const handleTableContextMenu = (e: React.MouseEvent) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>("tr[data-tag-id]")
    if (!rowEl) {
      e.preventDefault()
      return
    }
    const id = Number(rowEl.dataset.tagId)
    if (!selected.has(id)) selectOnly(id)
    setContextMenuAnchorKey((k) => k + 1)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <h1 className="shrink-0 text-2xl font-semibold">Tags</h1>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setNewTagOpen(true)}>
          <Plus className="h-4 w-4" />
          New Tag
        </Button>
        <TagDialog open={newTagOpen} onOpenChange={setNewTagOpen} />

        <Button variant="outline" size="sm" disabled={size !== 1} onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
        {editTarget && <TagDialog open={editOpen} onOpenChange={setEditOpen} tag={editTarget} />}

        <Button variant="destructive" size="sm" disabled={!active} onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {size} selected tag{size === 1 ? "" : "s"}?</AlertDialogTitle>
              <AlertDialogDescription>
                They'll be removed from every item that has them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  bulkDeleteTags.mutate(
                    { ids: Array.from(selected) },
                    {
                      onSuccess: () => {
                        clear()
                        setDeleteOpen(false)
                      },
                    },
                  )
                }
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="relative ml-auto min-w-[160px] max-w-[280px] flex-1 sm:min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tags…"
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
          <p className="text-sm text-destructive">Failed to load tags: {(error as Error).message}</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tags yet. Create one, or add tags directly from a library item's edit dialog.
          </p>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground">No tags match "{search}".</p>
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
                        onCheckedChange={(checked) => (checked ? selectAll(pageData.map((t) => t.id)) : clear())}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Usage</TableHead>
                    {privacyEnabled && <TableHead>Private</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageData.map((tag) => (
                    <TagRow
                      key={tag.id}
                      tag={tag}
                      privacyEnabled={privacyEnabled}
                      selected={isSelected(tag.id)}
                      onSelectedChange={() => toggle(tag.id)}
                      onMouseDown={(e) => handleRowMouseDown(e, tag.id)}
                      onMouseEnter={() => handleRowMouseEnter(tag.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </ContextMenuTrigger>
            <ContextMenuContent key={contextMenuAnchorKey}>
              <ContextMenuItem onClick={() => setNewTagOpen(true)}>
                <Plus className="h-4 w-4" />
                New Tag
              </ContextMenuItem>
              <ContextMenuItem disabled={size !== 1} onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                Edit
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
            {total} {total === 1 ? "tag" : "tags"}
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

function TagRow({
  tag,
  privacyEnabled,
  selected,
  onSelectedChange,
  onMouseDown,
  onMouseEnter,
}: {
  tag: Tag
  privacyEnabled: boolean
  selected: boolean
  onSelectedChange: () => void
  onMouseDown: (e: React.MouseEvent) => void
  onMouseEnter: () => void
}) {
  return (
    <TableRow
      data-tag-id={tag.id}
      data-state={selected ? "selected" : undefined}
      className="cursor-default select-none"
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
    >
      <TableCell>
        <Checkbox checked={selected} onCheckedChange={onSelectedChange} aria-label={`Select ${tag.name}`} />
      </TableCell>
      <TableCell className="font-medium">{tag.name}</TableCell>
      <TableCell>
        <Badge variant="outline">
          {tag.usageCount} item{tag.usageCount === 1 ? "" : "s"}
        </Badge>
      </TableCell>
      {privacyEnabled && (
        <TableCell>
          {tag.isPrivate && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Private" />}
        </TableCell>
      )}
    </TableRow>
  )
}

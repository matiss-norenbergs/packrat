import { useEffect, useMemo, useState } from "react"
import { ChevronsDownUp, ChevronsUpDown, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { useCollections } from "@/hooks/useCollections"
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
import { Skeleton } from "@/components/ui/skeleton"
import { CollapsiblePanel } from "@/components/CollapsiblePanel"
import { CollectionDialog } from "@/components/collections/CollectionDialog"
import { CollectionInfoPanel } from "@/components/collections/CollectionInfoPanel"
import { CollectionTree } from "@/components/collections/CollectionTree"
import { useIdSelection } from "@/hooks/useIdSelection"
import { usePersistedOpen } from "@/hooks/usePersistedOpen"
import { useBulkDeleteCollections } from "@/hooks/useCollections"
import { buildCollectionTree, collectDescendantIds, filterCollectionTree } from "@/lib/collectionTree"
import { getPageNumbers } from "@/lib/pagination"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 25

const ALL_EXPANDED_STORAGE_KEY = "packrat:collections-all-expanded"

function readAllExpandedSetting(): boolean {
  return localStorage.getItem(ALL_EXPANDED_STORAGE_KEY) === "true"
}

export function CollectionsPage() {
  const { data, isLoading, isError, error } = useCollections()
  const { selected, isSelected, toggle, selectOnly, clear, size, active } = useIdSelection()
  const [newCollectionOpen, setNewCollectionOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const bulkDeleteCollections = useBulkDeleteCollections()
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [panelOpen, setPanelOpen] = usePersistedOpen("packrat:collections-panel-open", true)
  // Collapsed by default (empty set) — the tree is opt-in expanded per
  // node, or all at once via the toolbar's single toggle button below.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  // Whether the toolbar's single toggle button is currently in "everything
  // expanded" mode — drives its own label/icon; independent of any
  // individual node the user has since expanded/collapsed by hand.
  const [allExpanded, setAllExpanded] = useState(readAllExpandedSetting)

  useEffect(() => {
    localStorage.setItem(ALL_EXPANDED_STORAGE_KEY, String(allExpanded))
  }, [allExpanded])

  // Debounce the value actually used for filtering so fast typing doesn't
  // re-filter the tree on every keystroke — the input itself still updates
  // immediately via searchInput.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(id)
  }, [searchInput])

  const tree = data ? buildCollectionTree(data) : []
  const allIds = tree.flatMap(collectDescendantIds)
  const { tree: visibleTree, matchAncestorIds } = useMemo(
    () => filterCollectionTree(tree, search),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, search],
  )
  // Pagination counts only top-level (root) collections — a page shows up
  // to PAGE_SIZE root trees in full, including every nested descendant,
  // rather than counting nested items individually and risking a
  // parent/child split across pages.
  const total = visibleTree.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageTree = visibleTree.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  // Every node across every root subtree currently visible (all levels, all
  // pages) — distinct from `total`, which only counts root/top-level trees.
  const totalAllLevels = visibleTree.flatMap(collectDescendantIds).length

  // A search that shrinks the result set out from under the current page
  // number would otherwise show an empty page instead of snapping back.
  useEffect(() => {
    setPage(1)
  }, [search])

  // Restoring allExpanded=true from localStorage happens before `data` has
  // loaded (allIds is empty on first render), and any later mutation
  // (creating a collection, editing one) reloads `data` too — keep
  // expandedIds in sync with the current id set whenever "expand all" mode
  // is active, rather than only applying it once at mount.
  useEffect(() => {
    if (allExpanded) setExpandedIds(new Set(allIds))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allExpanded, data])

  const editTarget = size === 1 ? data?.find((c) => selected.has(c.id)) : undefined
  const toggleExpanded = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // A match nested several levels down needs its ancestors expanded to be
  // visible at all — forced only while a search is active, and not written
  // into expandedIds itself, so clearing the search restores exactly
  // whatever the user had manually expanded/collapsed before searching.
  const isExpandedForDisplay = (id: number) => expandedIds.has(id) || matchAncestorIds.has(id)

  // Plain click (no drag) selects only this row; ctrl/cmd+click toggles it
  // in or out of the current selection without clearing the rest — the
  // checkbox is the one exception, it keeps its own toggle-without-clearing
  // behavior via onToggle. No drag-select or shift-click range here, unlike
  // Tags/Artists — not asked for on this page.
  //
  // Each row nests its own Add-sub-collection/Edit CollectionDialog as a
  // React child, so the Dialog's portaled content (rendered to
  // document.body) is still a React *descendant* of the row even though
  // it's nowhere in the row's actual DOM subtree — React bubbles synthetic
  // events through the component tree, not the DOM tree, so clicks inside
  // that dialog (its Name field, Selects, etc.) were reaching this handler
  // and getting preventDefault()'d, breaking focus/typing in the dialog.
  // Bailing out unless the target is a real DOM descendant of the row
  // excludes portaled content without excluding the checkbox/buttons, which
  // are genuinely inside the row.
  const handleRowMouseDown = (e: React.MouseEvent, id: number) => {
    if (e.button !== 0 || !e.currentTarget.contains(e.target as Node)) return
    if ((e.target as HTMLElement).closest('[role="checkbox"], button') != null) return
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      toggle(id)
      return
    }
    selectOnly(id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <h1 className="shrink-0 text-2xl font-semibold">Collections</h1>

      <div
        className={cn(
          "flex min-h-0 flex-1 transition-[gap] duration-300 ease-in-out",
          panelOpen ? "gap-4 md:gap-6" : "gap-0",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setNewCollectionOpen(true)}>
              <Plus className="h-4 w-4" />
              New Collection
            </Button>
            <CollectionDialog open={newCollectionOpen} onOpenChange={setNewCollectionOpen} />

            <Button variant="outline" size="sm" disabled={size !== 1} onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            {editTarget && <CollectionDialog open={editOpen} onOpenChange={setEditOpen} collection={editTarget} />}

            <Button variant="destructive" size="sm" disabled={!active} onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
            <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {size} selected collection{size === 1 ? "" : "s"}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Existing downloads and library items in these collections become uncategorized —
                    they are not deleted. A selected collection whose sub-collection wasn't also
                    selected will be skipped.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      bulkDeleteCollections.mutate(
                        { ids: Array.from(selected) },
                        {
                          onSuccess: () => {
                            clear()
                            setBulkDeleteOpen(false)
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

            {active && (
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className="ml-auto gap-1.5"
              onClick={() => {
                setAllExpanded((v) => !v)
                setExpandedIds(allExpanded ? new Set() : new Set(allIds))
              }}
            >
              {allExpanded ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
              {allExpanded ? "Collapse" : "Expand"}
            </Button>

            <div className="relative min-w-[160px] max-w-[280px] flex-1 sm:min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search collections…"
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
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : isError ? (
              <p className="text-sm text-destructive">Failed to load collections: {(error as Error).message}</p>
            ) : !data || data.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No collections yet. Create one to set a default folder, quality, and type for a group of
                downloads.
              </p>
            ) : visibleTree.length === 0 ? (
              <p className="text-sm text-muted-foreground">No collections match "{search}".</p>
            ) : (
              <CollectionTree
                nodes={pageTree}
                isSelected={isSelected}
                onToggle={toggle}
                onRowMouseDown={handleRowMouseDown}
                isExpanded={isExpandedForDisplay}
                onToggleExpanded={toggleExpanded}
              />
            )}
          </div>

          {!isLoading && data && data.length > 0 && total > 0 && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                {total} top-level {total === 1 ? "collection" : "collections"} ({totalAllLevels} total)
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

        <CollapsiblePanel open={panelOpen} onOpenChange={setPanelOpen} label="collection details panel">
          {panelOpen && <CollectionInfoPanel collection={editTarget} selectedCount={size} />}
        </CollapsiblePanel>
      </div>
    </div>
  )
}

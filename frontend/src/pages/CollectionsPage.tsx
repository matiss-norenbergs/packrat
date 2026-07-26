import { useState } from "react"
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { useCollections } from "@/hooks/useCollections"
import { Button } from "@/components/ui/button"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { CollectionDialog } from "@/components/collections/CollectionDialog"
import { CollectionTree } from "@/components/collections/CollectionTree"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useBulkDeleteCollections } from "@/hooks/useCollections"
import { buildCollectionTree, collectDescendantIds } from "@/lib/collectionTree"

export function CollectionsPage() {
  const { data, isLoading, isError, error } = useCollections()
  const { selected, isSelected, toggle, clear, size, active } = useIdSelection()
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const bulkDeleteCollections = useBulkDeleteCollections()
  // Collapsed by default (empty set) — the tree is opt-in expanded per
  // node, or all at once via the toolbar's Expand all/Collapse all buttons.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const tree = data ? buildCollectionTree(data) : []
  const allIds = tree.flatMap(collectDescendantIds)
  const toggleExpanded = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Collections</h1>
        <CollectionDialog />
      </div>

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
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {active ? `${size} selected` : "Select collections to bulk edit"}
            </span>
            {active && (
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!active}>
                  Bulk operations
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-48">
                <DropdownMenuItem onSelect={() => setBulkDeleteOpen(true)}>Delete selected…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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

            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setExpandedIds(new Set(allIds))}>
                <ChevronsUpDown className="h-4 w-4" />
                Expand all
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setExpandedIds(new Set())}>
                <ChevronsDownUp className="h-4 w-4" />
                Collapse all
              </Button>
            </div>
          </div>

          <CollectionTree
            nodes={tree}
            isSelected={isSelected}
            onToggle={toggle}
            isExpanded={(id) => expandedIds.has(id)}
            onToggleExpanded={toggleExpanded}
          />
        </>
      )}
    </div>
  )
}

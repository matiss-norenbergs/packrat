import { useState } from "react"
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
import { buildCollectionTree } from "@/lib/collectionTree"

export function CollectionsPage() {
  const { data, isLoading, isError, error } = useCollections()
  const { selected, isSelected, toggle, clear, size, active } = useIdSelection()
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const bulkDeleteCollections = useBulkDeleteCollections()

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
          </div>

          <CollectionTree nodes={buildCollectionTree(data)} isSelected={isSelected} onToggle={toggle} />
        </>
      )}
    </div>
  )
}

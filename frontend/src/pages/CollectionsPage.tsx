import { useCollections } from "@/hooks/useCollections"
import { Skeleton } from "@/components/ui/skeleton"
import { CollectionDialog } from "@/components/collections/CollectionDialog"
import { CollectionTree } from "@/components/collections/CollectionTree"
import { buildCollectionTree } from "@/lib/collectionTree"

export function CollectionsPage() {
  const { data, isLoading, isError, error } = useCollections()

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
        <CollectionTree nodes={buildCollectionTree(data)} />
      )}
    </div>
  )
}

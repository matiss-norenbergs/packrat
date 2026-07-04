import { useCollections } from "@/hooks/useCollections"
import { Skeleton } from "@/components/ui/skeleton"
import { CollectionDialog } from "@/components/collections/CollectionDialog"
import { CollectionCard } from "@/components/collections/CollectionCard"

export function CollectionsPage() {
  const { data, isLoading, isError, error } = useCollections()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Collections</h1>
        <CollectionDialog />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Failed to load collections: {(error as Error).message}</p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No collections yet. Create one to set a default folder, quality, and type for a group of
          downloads.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((collection) => (
            <CollectionCard key={collection.id} collection={collection} />
          ))}
        </div>
      )}
    </div>
  )
}

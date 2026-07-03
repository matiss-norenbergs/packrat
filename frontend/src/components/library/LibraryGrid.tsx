import { useLibrary } from "@/hooks/useLibrary"
import { Skeleton } from "@/components/ui/skeleton"
import { LibraryCard } from "./LibraryCard"

export function LibraryGrid() {
  const { data, isLoading, isError, error } = useLibrary()

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="aspect-video w-full" />
      </div>
    )
  }

  if (isError) {
    return <p className="text-sm text-destructive">Failed to load library: {(error as Error).message}</p>
  }

  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing here yet. Completed downloads will show up in your library.</p>
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {data.map((item) => (
        <LibraryCard key={item.id} item={item} />
      ))}
    </div>
  )
}

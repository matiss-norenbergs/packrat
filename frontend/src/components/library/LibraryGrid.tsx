import { useSearchParams } from "react-router-dom"
import { useLibrary } from "@/hooks/useLibrary"
import { Skeleton } from "@/components/ui/skeleton"
import { searchLibraryItems, sortLibraryItems, type LibrarySortDir, type LibrarySortKey } from "@/lib/libraryFilters"
import { LibraryCard } from "./LibraryCard"

export function LibraryGrid() {
  const { data, isLoading, isError, error } = useLibrary()
  const [searchParams] = useSearchParams()

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

  const search = searchParams.get("q") ?? ""
  const sortKey = (searchParams.get("sort") as LibrarySortKey) || "downloadedAt"
  const sortDir: LibrarySortDir = searchParams.get("dir") === "asc" ? "asc" : "desc"
  const collectionId = searchParams.get("collection")
  const year = searchParams.get("year")

  let filtered = searchLibraryItems(data, search)
  if (collectionId) filtered = filtered.filter((item) => String(item.collectionId) === collectionId)
  if (year) filtered = filtered.filter((item) => String(item.year) === year)
  const sorted = sortLibraryItems(filtered, sortKey, sortDir)

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">No library items match these filters.</p>
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {sorted.map((item) => (
        <LibraryCard key={item.id} item={item} />
      ))}
    </div>
  )
}

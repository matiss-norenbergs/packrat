import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useLibraryQuery } from "@/hooks/useLibrary"
import { useSettings } from "@/hooks/useSettings"
import { Skeleton } from "@/components/ui/skeleton"
import { LibraryCard } from "./LibraryCard"
import { LibraryPagination } from "./LibraryPagination"

export function LibraryGrid() {
  const { data: settings, isLoading: settingsLoading } = useSettings()
  const [searchParams] = useSearchParams()
  const [page, setPage] = useState(1)

  const search = searchParams.get("q") ?? ""
  const sortKey = settings?.librarySortKey || "downloadedAt"
  const sortDir = settings?.librarySortDir === "asc" ? "asc" : "desc"
  const collectionId = searchParams.get("collection")
  const year = searchParams.get("year")
  const tagNames = (searchParams.get("tags") ?? "").split(",").filter(Boolean)
  const paginationEnabled = settings?.libraryPaginationEnabled ?? false
  const pageSize = settings?.libraryPageSize || 48
  const hasFilters = Boolean(search || collectionId || year || tagNames.length > 0)

  // Reset to page 1 whenever a filter/search/sort changes underneath the
  // current page — otherwise "page 3" could point at nothing once the
  // result set shrinks.
  const tagsKey = tagNames.join(",")
  useEffect(() => {
    setPage(1)
  }, [search, collectionId, year, tagsKey, sortKey, sortDir])

  const { data, isLoading, isError, error } = useLibraryQuery({
    q: search || undefined,
    collectionId: collectionId ? Number(collectionId) : undefined,
    year: year ? Number(year) : undefined,
    tags: tagNames.length > 0 ? tagNames : undefined,
    sortKey,
    sortDir,
    page: paginationEnabled ? page : undefined,
    pageSize: paginationEnabled ? pageSize : undefined,
  })

  if (isLoading || settingsLoading) {
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

  if (!data || data.total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {hasFilters
          ? "No library items match these filters."
          : "Nothing here yet. Completed downloads will show up in your library."}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {data.items.map((item) => (
          <LibraryCard key={item.id} item={item} />
        ))}
      </div>
      {paginationEnabled && <LibraryPagination page={page} pageSize={pageSize} total={data.total} onPageChange={setPage} />}
    </div>
  )
}

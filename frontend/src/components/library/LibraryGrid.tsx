import type { ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { useLibraryQuery } from "@/hooks/useLibrary"
import { usePageState } from "@/hooks/usePageState"
import { useSettings } from "@/hooks/useSettings"
import { useLibrarySort } from "@/hooks/useLibrarySort"
import { Skeleton } from "@/components/ui/skeleton"
import { LibraryCard } from "./LibraryCard"
import { LibraryPagination } from "./LibraryPagination"
import { LibraryScrollView } from "./LibraryScrollView"

export function LibraryGrid() {
  const { data: settings, isLoading: settingsLoading } = useSettings()
  const [searchParams] = useSearchParams()

  const search = searchParams.get("q") ?? ""
  const { sort, ready: sortReady } = useLibrarySort()
  const { key: sortKey, dir: sortDir } = sort
  const collectionId = searchParams.get("collection")
  const year = searchParams.get("year")
  const tagNames = (searchParams.get("tags") ?? "").split(",").filter(Boolean)
  const hideGhosts = searchParams.get("hideGhosts") === "true"
  const paginationEnabled = settings?.libraryPaginationEnabled ?? false
  const pageSize = settings?.libraryPageSize || 48
  const hasFilters = Boolean(search || collectionId || year || tagNames.length > 0 || hideGhosts)

  // Back to page 1 whenever a filter/search/sort changes underneath the
  // current page — otherwise "page 3" could point at nothing once the
  // result set shrinks.
  const [page, setPage] = usePageState(JSON.stringify([search, collectionId, year, tagNames.join(","), hideGhosts, sortKey, sortDir]))

  const { data, isLoading, isError, error } = useLibraryQuery({
    q: search || undefined,
    collectionId: collectionId ? Number(collectionId) : undefined,
    year: year ? Number(year) : undefined,
    tags: tagNames.length > 0 ? tagNames : undefined,
    hideGhosts: hideGhosts || undefined,
    sortKey,
    sortDir,
    page: paginationEnabled ? page : undefined,
    pageSize: paginationEnabled ? pageSize : undefined,
  }, sortReady)

  // Everything that starts a new view at the top (the page is already 1 in the pass that sees a changed filter).
  const resetKey = JSON.stringify([page, search, collectionId, year, tagNames.join(","), hideGhosts, sortKey, sortDir])

  let content: ReactNode
  if (isLoading || settingsLoading || !sortReady) {
    content = (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="aspect-video w-full" />
      </div>
    )
  } else if (isError) {
    content = <p className="text-sm text-destructive">Failed to load library: {(error as Error).message}</p>
  } else if (!data || data.total === 0) {
    content = (
      <p className="text-sm text-muted-foreground">
        {hasFilters
          ? "No library items match these filters."
          : "Nothing here yet. Completed downloads will show up in your library."}
      </p>
    )
  } else {
    content = (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {data.items.map((item) => (
          <LibraryCard key={item.id} item={item} />
        ))}
      </div>
    )
  }

  // Pagination on and the settings known: the footer stays through the load (placeholder), so the region does not jump.
  const pending = isLoading || !sortReady
  const showFooter = paginationEnabled && !settingsLoading && !isError && (pending || (data != null && data.total > 0))
  return (
    <LibraryScrollView
      resetKey={resetKey}
      footer={
        showFooter && (
          <LibraryPagination page={page} pageSize={pageSize} total={pending ? 0 : (data?.total ?? 0)} onPageChange={setPage} loading={pending} />
        )
      }
    >
      {content}
    </LibraryScrollView>
  )
}

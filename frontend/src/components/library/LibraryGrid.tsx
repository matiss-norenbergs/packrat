import { useSearchParams } from "react-router-dom"
import { useLibraryQuery } from "@/hooks/useLibrary"
import { usePageState } from "@/hooks/usePageState"
import { useSettings } from "@/hooks/useSettings"
import { useLibrarySort } from "@/hooks/useLibrarySort"
import { ResponsiveGrid } from "@/components/responsive-grid"
import type { LibraryItem } from "@/types/api"
import { LibraryCard, LibraryCardGrid } from "./LibraryCard"
import { LibraryCardsProvider } from "./LibraryCardsProvider"
import { LibraryPagination } from "./LibraryPagination"
import { LibraryScrollView } from "./LibraryScrollView"

const getKey = (item: LibraryItem) => item.id
const renderItem = (item: LibraryItem) => <LibraryCard item={item} />
const NO_ITEMS: readonly LibraryItem[] = []

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

  const { data, isLoading, isError, error: queryError } = useLibraryQuery({
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

  const loading = isLoading || settingsLoading || !sortReady
  const error = !loading && isError ? <p className="text-sm text-destructive">Failed to load library: {(queryError as Error).message}</p> : undefined
  const empty =
    !loading && !isError && (!data || data.total === 0) ? (
      <p className="text-sm text-muted-foreground">
        {hasFilters
          ? "No library items match these filters."
          : "Nothing here yet. Completed downloads will show up in your library."}
      </p>
    ) : undefined

  // Pagination on and the settings known: the footer stays through the load (placeholder), so the region does not jump.
  const pending = isLoading || !sortReady
  const showFooter = paginationEnabled && !settingsLoading && !isError && (pending || (data != null && data.total > 0))
  return (
    <LibraryCardsProvider items={data?.items}>
      <LibraryScrollView
        footer={
          showFooter && (
            <LibraryPagination page={page} pageSize={pageSize} total={pending ? 0 : (data?.total ?? 0)} onPageChange={setPage} loading={pending} />
          )
        }
      >
        <ResponsiveGrid
          items={data?.items ?? NO_ITEMS}
          getKey={getKey}
          renderItem={renderItem}
          columns="library"
          resetKey={resetKey}
          loading={loading}
          error={error}
          empty={empty}
          gridClassName="group/lib-grid"
          gridComponent={LibraryCardGrid}
          scrollTestId="library-scroll"
        />
      </LibraryScrollView>
    </LibraryCardsProvider>
  )
}

import { Fragment, useCallback, useMemo } from "react"
import type { ReactNode } from "react"
import { ChevronRight, Home } from "lucide-react"
import { useSearchParams } from "react-router-dom"
import { ResponsiveGrid } from "@/components/responsive-grid"
import { Skeleton } from "@/components/ui/skeleton"
import { useCollections } from "@/hooks/useCollections"
import { useLibraryQuery } from "@/hooks/useLibrary"
import { usePageState } from "@/hooks/usePageState"
import { useSettings } from "@/hooks/useSettings"
import { useLibrarySort } from "@/hooks/useLibrarySort"
import { buildCollectionTree, findNodeById } from "@/lib/collectionTree"
import type { CollectionTreeNode } from "@/lib/collectionTree"
import type { Collection, LibraryItem } from "@/types/api"
import { CollectionFolderTile } from "./CollectionFolderTile"
import { LibraryCard, LibraryCardGrid } from "./LibraryCard"
import { LibraryCardsProvider } from "./LibraryCardsProvider"
import { LibraryPagination } from "./LibraryPagination"
import { LibraryScrollView } from "./LibraryScrollView"

// One cell of the grid: the folder tiles come first, then the items. Keys are prefixed because both kinds share one list.
type FolderCell = { kind: "folder"; node: CollectionTreeNode } | { kind: "item"; item: LibraryItem }
const cellKey = (cell: FolderCell) => (cell.kind === "folder" ? `f${cell.node.id}` : `i${cell.item.id}`)

// Walks parentId up to the root using a flat id->Collection map, rather than
// the generated `.path` string — path segments are names, and two
// collections in different branches can share a name (names are only
// unique per-parent), so walking real ids avoids any ambiguity.
function breadcrumbFor(collections: Collection[], id: number): Collection[] {
  const byId = new Map(collections.map((c) => [c.id, c]))
  const trail: Collection[] = []
  let current = byId.get(id)
  while (current) {
    trail.unshift(current)
    current = current.parentId != null ? byId.get(current.parentId) : undefined
  }
  return trail
}

// The breadcrumb row. One component for the loaded and the loading state, so the two rows (and the region under them)
// cannot drift apart: inside a folder the names are not known until the collections load, so a skeleton stands in for them.
function FolderBreadcrumb({ trail, loading, onNavigate }: { trail: Collection[]; loading: boolean; onNavigate: (id: number | null) => void }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
      <button
        type="button"
        onClick={() => onNavigate(null)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
      >
        <Home className="h-3.5 w-3.5" />
        Root
      </button>
      {loading ? (
        <>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          <Skeleton className="h-4 w-24" />
        </>
      ) : (
        trail.map((c) => (
          <Fragment key={c.id}>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            <button
              type="button"
              onClick={() => onNavigate(c.id)}
              className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
            >
              {c.name}
            </button>
          </Fragment>
        ))
      )}
    </div>
  )
}

export function LibraryFolderView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: collections, isLoading: collectionsLoading } = useCollections()
  const { data: settings, isLoading: settingsLoading } = useSettings()

  const currentIdParam = searchParams.get("collection")
  const currentId = currentIdParam ? Number(currentIdParam) : null
  const search = searchParams.get("q") ?? ""
  const { sort, ready: sortReady } = useLibrarySort()
  const { key: sortKey, dir: sortDir } = sort
  const tagNames = (searchParams.get("tags") ?? "").split(",").filter(Boolean)
  const hideGhosts = searchParams.get("hideGhosts") === "true"
  const paginationEnabled = settings?.libraryPaginationEnabled ?? false
  const pageSize = settings?.libraryPageSize || 48

  // Back to page 1 whenever the open folder or a filter/search/sort changes
  // underneath the current page.
  const [page, setPage] = usePageState(JSON.stringify([currentId, search, tagNames.join(","), hideGhosts, sortKey, sortDir]))

  const {
    data,
    isLoading: itemsLoading,
    isError,
    error,
  } = useLibraryQuery({
    collectionId: currentId, // null = uncategorized-only (root); number = this folder only
    q: search || undefined,
    tags: tagNames.length > 0 ? tagNames : undefined,
    hideGhosts: hideGhosts || undefined,
    sortKey,
    sortDir,
    page: paginationEnabled ? page : undefined,
    pageSize: paginationEnabled ? pageSize : undefined,
  }, sortReady)

  // Everything that starts a new view at the top (the page is already 1 in the pass that sees a changed filter).
  const resetKey = JSON.stringify([page, currentId, search, tagNames.join(","), hideGhosts, sortKey, sortDir])

  const goTo = useCallback(
    (id: number | null) => {
      const next = new URLSearchParams(searchParams)
      if (id == null) next.delete("collection")
      else next.set("collection", String(id))
      setSearchParams(next) // pushes a history entry so Back navigates up a level
    },
    [searchParams, setSearchParams],
  )

  // The cells: this folder's sub-folders first, then its items.
  const tree = useMemo(() => (collections ? buildCollectionTree(collections) : null), [collections])
  const childNodes = useMemo(() => {
    if (!tree) return []
    const currentNode = currentId != null ? findNodeById(tree, currentId) : null
    return currentNode ? currentNode.children : tree
  }, [tree, currentId])
  const cells = useMemo<FolderCell[]>(
    () => [
      ...childNodes.map((node): FolderCell => ({ kind: "folder", node })),
      ...(data?.items ?? []).map((item): FolderCell => ({ kind: "item", item })),
    ],
    [childNodes, data?.items],
  )
  const renderCell = useCallback(
    (cell: FolderCell) =>
      cell.kind === "folder" ? (
        <CollectionFolderTile node={cell.node} collections={collections ?? []} onClick={() => goTo(cell.node.id)} />
      ) : (
        <LibraryCard item={cell.item} />
      ),
    [collections, goTo],
  )

  // The one grid of every state (same element type in every branch below, so the scroll region keeps its DOM across them).
  const grid = (state: { loading?: boolean; error?: ReactNode; empty?: ReactNode }) => (
    <ResponsiveGrid
      items={cells}
      getKey={cellKey}
      renderItem={renderCell}
      columns="library"
      resetKey={resetKey}
      gridClassName="group/lib-grid"
      gridComponent={LibraryCardGrid}
      scrollTestId="library-scroll"
      {...state}
    />
  )

  const view = (() => {
    // Inside a folder the loading row shows a skeleton for the names; at the root there is nothing more than Root.
    const loadingHeader = <FolderBreadcrumb trail={[]} loading={currentId != null} onNavigate={goTo} />

    if (collectionsLoading || itemsLoading || settingsLoading || !sortReady) {
      return (
        <LibraryScrollView
          header={loadingHeader}
          footer={
            !settingsLoading && paginationEnabled && <LibraryPagination page={page} pageSize={pageSize} total={0} onPageChange={setPage} loading />
          }
        >
          {grid({ loading: true })}
        </LibraryScrollView>
      )
    }
    if (isError) {
      return (
        <LibraryScrollView
          header={
            <FolderBreadcrumb
              trail={collections && currentId != null ? breadcrumbFor(collections, currentId) : []}
              loading={!collections && currentId != null}
              onNavigate={goTo}
            />
          }
        >
          {grid({ error: <p className="text-sm text-destructive">Failed to load library: {(error as Error).message}</p> })}
        </LibraryScrollView>
      )
    }
    if (!collections || !data) return null

    const breadcrumb = currentId != null ? breadcrumbFor(collections, currentId) : []

    const isEmpty = childNodes.length === 0 && data.total === 0

    return (
      <LibraryScrollView
        header={<FolderBreadcrumb trail={breadcrumb} loading={false} onNavigate={goTo} />}
        footer={!isEmpty && paginationEnabled && <LibraryPagination page={page} pageSize={pageSize} total={data.total} onPageChange={setPage} />}
      >
        {grid({ empty: isEmpty ? <p className="text-sm text-muted-foreground">This collection is empty.</p> : undefined })}
      </LibraryScrollView>
    )
  })()

  // One provider for every state (loading, error, loaded), so the scroll region keeps its DOM across them.
  return <LibraryCardsProvider items={data?.items}>{view}</LibraryCardsProvider>
}

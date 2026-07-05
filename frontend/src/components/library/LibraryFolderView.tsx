import { Fragment } from "react"
import { ChevronRight, Home } from "lucide-react"
import { useSearchParams } from "react-router-dom"
import { Skeleton } from "@/components/ui/skeleton"
import { useCollections } from "@/hooks/useCollections"
import { useLibrary } from "@/hooks/useLibrary"
import { buildCollectionTree, type CollectionTreeNode } from "@/lib/collectionTree"
import { searchLibraryItems, sortLibraryItems, type LibrarySortDir, type LibrarySortKey } from "@/lib/libraryFilters"
import type { Collection } from "@/types/api"
import { CollectionFolderTile } from "./CollectionFolderTile"
import { LibraryCard } from "./LibraryCard"

function findNodeById(nodes: CollectionTreeNode[], id: number): CollectionTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNodeById(node.children, id)
    if (found) return found
  }
  return null
}

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

export function LibraryFolderView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: collections, isLoading: collectionsLoading } = useCollections()
  const { data: items, isLoading: itemsLoading, isError, error } = useLibrary()

  if (collectionsLoading || itemsLoading) {
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
  if (!collections || !items) return null

  const currentIdParam = searchParams.get("collection")
  const currentId = currentIdParam ? Number(currentIdParam) : null

  const goTo = (id: number | null) => {
    const next = new URLSearchParams(searchParams)
    if (id == null) next.delete("collection")
    else next.set("collection", String(id))
    setSearchParams(next) // pushes a history entry so Back navigates up a level
  }

  const tree = buildCollectionTree(collections)
  const currentNode = currentId != null ? findNodeById(tree, currentId) : null
  const childNodes = currentNode ? currentNode.children : tree
  const breadcrumb = currentId != null ? breadcrumbFor(collections, currentId) : []

  const search = searchParams.get("q") ?? ""
  const sortKey = (searchParams.get("sort") as LibrarySortKey) || "downloadedAt"
  const sortDir: LibrarySortDir = searchParams.get("dir") === "asc" ? "asc" : "desc"

  const itemsHere = items.filter((item) => item.collectionId === currentId)
  const sortedItems = sortLibraryItems(searchLibraryItems(itemsHere, search), sortKey, sortDir)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <button
          type="button"
          onClick={() => goTo(null)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
        >
          <Home className="h-3.5 w-3.5" />
          Root
        </button>
        {breadcrumb.map((c) => (
          <Fragment key={c.id}>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            <button
              type="button"
              onClick={() => goTo(c.id)}
              className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
            >
              {c.name}
            </button>
          </Fragment>
        ))}
      </div>

      {childNodes.length === 0 && sortedItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">This collection is empty.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {childNodes.map((node) => (
            <CollectionFolderTile key={node.id} node={node} onClick={() => goTo(node.id)} />
          ))}
          {sortedItems.map((item) => (
            <LibraryCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

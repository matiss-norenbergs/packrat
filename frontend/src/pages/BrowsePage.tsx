import { useSearchParams } from "react-router-dom"
import { Skeleton } from "@/components/ui/skeleton"
import { BrowseHero } from "@/components/browse/BrowseHero"
import { BrowseRow } from "@/components/browse/BrowseRow"
import { BrowseTile } from "@/components/browse/BrowseTile"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { useLibrary, useLibraryQuery } from "@/hooks/useLibrary"
import { useCollections } from "@/hooks/useCollections"
import { useArtists } from "@/hooks/useArtists"
import { buildCollectionTree, collectDescendantIds } from "@/lib/collectionTree"
import { sortLibraryItems } from "@/lib/libraryFilters"

const RECENTLY_ADDED_COUNT = 24
// Artists with fewer items than this aren't worth a whole row of their own.
const MIN_ARTIST_ROW_SIZE = 2

export function BrowsePage() {
  const [searchParams] = useSearchParams()
  const search = searchParams.get("q") ?? ""

  const { data: items, isLoading: itemsLoading } = useLibrary()
  const { data: collections, isLoading: collectionsLoading } = useCollections()
  const { data: artists, isLoading: artistsLoading } = useArtists()
  const searchResults = useLibraryQuery({ q: search, pageSize: 100 }, search.length > 0)

  if (search) {
    return (
      <RevealAllProvider>
        <div className="space-y-6 p-4 md:p-8">
          <h1 className="text-lg font-semibold">Results for "{search}"</h1>
          {searchResults.isLoading ? (
            <BrowseRowSkeleton />
          ) : searchResults.data && searchResults.data.items.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {searchResults.data.items.map((item) => (
                <BrowseTile key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No matches.</p>
          )}
        </div>
      </RevealAllProvider>
    )
  }

  if (itemsLoading || collectionsLoading || artistsLoading || !items || !collections || !artists) {
    return (
      <div className="space-y-8 p-4 md:p-8">
        <Skeleton className="h-[50vh] min-h-72 w-full md:h-[60vh]" />
        <BrowseRowSkeleton />
        <BrowseRowSkeleton />
      </div>
    )
  }

  const recentlyAdded = sortLibraryItems(items, "downloadedAt", "desc").slice(0, RECENTLY_ADDED_COUNT)
  const hero = recentlyAdded.find((i) => !i.blurred)

  const collectionRows = buildCollectionTree(collections)
    .map((root) => {
      const descendantIds = new Set(collectDescendantIds(root))
      const rowItems = sortLibraryItems(
        items.filter((i) => i.collectionId != null && descendantIds.has(i.collectionId)),
        "downloadedAt",
        "desc",
      )
      return { key: `collection-${root.id}`, title: root.name, items: rowItems }
    })
    .filter((row) => row.items.length > 0)

  const artistRows = artists
    .filter((a) => a.usageCount >= MIN_ARTIST_ROW_SIZE)
    .map((artist) => ({
      key: `artist-${artist.id}`,
      title: artist.name,
      items: sortLibraryItems(
        items.filter((i) => i.artistId === artist.id),
        "downloadedAt",
        "desc",
      ),
    }))
    .filter((row) => row.items.length > 0)

  return (
    <RevealAllProvider>
      <div className="space-y-8 pb-8">
        {hero && <BrowseHero item={hero} />}
        <div className="space-y-6 px-4 md:px-8">
          <BrowseRow title="Recently Added" items={recentlyAdded} />
          {collectionRows.map((row) => (
            <BrowseRow key={row.key} title={row.title} items={row.items} />
          ))}
          {artistRows.map((row) => (
            <BrowseRow key={row.key} title={row.title} items={row.items} />
          ))}
          {recentlyAdded.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing downloaded yet.</p>
          )}
        </div>
      </div>
    </RevealAllProvider>
  )
}

function BrowseRowSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-5 w-32" />
      <div className="flex gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="aspect-video w-44 shrink-0 rounded-md" />
        ))}
      </div>
    </div>
  )
}

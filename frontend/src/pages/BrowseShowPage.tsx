import { Link, useParams } from "react-router-dom"
import { ImageIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BrowseShowRow } from "@/components/browse/BrowseShowRow"
import { HorizontalScroller } from "@/components/browse/HorizontalScroller"
import { LibraryItemStripTile } from "@/components/library/LibraryItemStripTile"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { useLibraryQuery } from "@/hooks/useLibrary"
import { useCollections } from "@/hooks/useCollections"
import { useArtists } from "@/hooks/useArtists"
import { useSettings } from "@/hooks/useSettings"
import {
  buildCollectionTree,
  collectDescendantIds,
  findNodeById,
  resolveInheritedArtistId,
  topLevelAncestor,
} from "@/lib/collectionTree"
import { buildShowSummary, computeShowStats, groupShowItems } from "@/lib/browseShows"
import { imageUrl } from "@/lib/api"

export function BrowseShowPage() {
  const { id } = useParams<{ id: string }>()
  const collectionId = Number(id)

  const { data: collections, isLoading: collectionsLoading } = useCollections()
  const { data: artists, isLoading: artistsLoading } = useArtists()
  const { data: settings } = useSettings()
  const ignorePrivacy = settings?.browseIgnorePrivacy ?? false

  const tree = collections ? buildCollectionTree(collections) : []
  const collection = collections?.find((c) => c.id === collectionId)
  const node = collection ? findNodeById(tree, collection.id) : null
  const descendantIds = node ? collectDescendantIds(node) : []

  // Scoped to just this show's own subtree — never the whole library.
  const itemsQuery = useLibraryQuery(
    { collectionIds: descendantIds, sortKey: "downloadedAt", sortDir: "desc" },
    descendantIds.length > 0,
  )

  if (collectionsLoading || artistsLoading || itemsQuery.isLoading || !collections || !artists) {
    return (
      <div className="space-y-6 p-4 md:p-8">
        <Skeleton className="h-[40vh] min-h-56 w-full" />
        <Skeleton className="h-5 w-40" />
        <div className="flex gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-video w-40 shrink-0 rounded-md" />
          ))}
        </div>
      </div>
    )
  }

  if (!collection || !node) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">This show doesn't exist (it may have been deleted).</p>
        <Button asChild variant="outline">
          <Link to="/browse">Back to Browse</Link>
        </Button>
      </div>
    )
  }

  const showItems = itemsQuery.data?.items ?? []
  const summary = buildShowSummary(collection)
  const effectiveBlurred = summary.isPrivate && !ignorePrivacy
  const stats = computeShowStats(showItems)

  const artistId = resolveInheritedArtistId(collections, collection.id)
  const artist = artistId != null ? artists.find((a) => a.id === artistId) : undefined

  const episodeGroups = groupShowItems(node, showItems)

  // Similar shows need no item fetch at all — buildShowSummary reads
  // straight off each collection's own response fields (see BrowsePage).
  const root = topLevelAncestor(collections, collection.id)
  const similarShows = collections
    .filter((c) => c.browseAsShow && c.id !== collection.id && c.totalItemCount > 0)
    .filter((c) => {
      const cArtistId = resolveInheritedArtistId(collections, c.id)
      const cRoot = topLevelAncestor(collections, c.id)
      return (artistId != null && cArtistId === artistId) || (root != null && cRoot?.id === root.id)
    })
    .map((c) => buildShowSummary(c))

  const backTo = `/browse/collection/${collection.id}`

  return (
    <RevealAllProvider>
      <div className="space-y-8 pb-8">
        <div className="relative flex h-[40vh] min-h-56 w-full items-end overflow-hidden">
          {summary.coverUrlLarge && !effectiveBlurred ? (
            <img src={summary.coverUrlLarge} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <ImageIcon className="h-12 w-12 text-muted-foreground/40" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
          <div className="relative space-y-2 p-6 md:p-10">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {summary.itemCount} {summary.itemCount === 1 ? "item" : "items"}
              {stats.yearRange && ` · ${stats.yearRange}`}
            </p>
            <h1 className="max-w-xl text-2xl font-bold md:text-4xl">{summary.name}</h1>
            {stats.topTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {stats.topTags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-8 px-4 md:px-8">
          {artist && (
            <Link to={`/browse/artist/${artist.id}`} className="flex w-fit items-center gap-3 hover:opacity-80">
              <div className="h-[4.86rem] w-[4.86rem] shrink-0 overflow-hidden rounded-full bg-muted">
                {artist.selectedImagePath ? (
                  <img src={imageUrl(artist.selectedImagePath)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImageIcon className="h-[2.025rem] w-[2.025rem] text-muted-foreground/40" />
                  </div>
                )}
              </div>
              <p className="text-[1.4175rem] font-medium">{artist.name}</p>
            </Link>
          )}

          {episodeGroups.map((group) => (
            <section key={group.key} className="space-y-2">
              <h2 className="text-lg font-semibold">{group.label}</h2>
              <HorizontalScroller className="gap-3">
                {group.items.map((item) => (
                  <LibraryItemStripTile
                    key={item.id}
                    item={item}
                    backTo={backTo}
                    basePath="/browse"
                    ignorePrivacy={ignorePrivacy}
                  />
                ))}
              </HorizontalScroller>
            </section>
          ))}

          {showItems.length === 0 && <p className="text-sm text-muted-foreground">Nothing in this show yet.</p>}

          {similarShows.length > 0 && <BrowseShowRow title="Similar content" shows={similarShows} />}
        </div>
      </div>
    </RevealAllProvider>
  )
}

import { Link, useParams } from "react-router-dom"
import { ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BrowseShowRow } from "@/components/browse/BrowseShowRow"
import { LibraryItemStripTile } from "@/components/library/LibraryItemStripTile"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { useLibrary } from "@/hooks/useLibrary"
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
import { buildShowSummary, groupShowItems, type ShowSummary } from "@/lib/browseShows"
import { imageUrl } from "@/lib/api"

export function BrowseShowPage() {
  const { id } = useParams<{ id: string }>()
  const collectionId = Number(id)

  const { data: items, isLoading: itemsLoading } = useLibrary()
  const { data: collections, isLoading: collectionsLoading } = useCollections()
  const { data: artists, isLoading: artistsLoading } = useArtists()
  const { data: settings } = useSettings()
  const ignorePrivacy = settings?.browseIgnorePrivacy ?? false

  if (itemsLoading || collectionsLoading || artistsLoading || !items || !collections || !artists) {
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

  const collection = collections.find((c) => c.id === collectionId)
  const tree = buildCollectionTree(collections)
  const node = collection ? findNodeById(tree, collection.id) : null

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

  const descendantIds = new Set(collectDescendantIds(node))
  const showItems = items.filter((i) => i.collectionId != null && descendantIds.has(i.collectionId))
  const summary = buildShowSummary(collection, showItems)
  const effectiveBlurred = summary.isPrivate && !ignorePrivacy

  const artistId = resolveInheritedArtistId(collections, collection.id)
  const artist = artistId != null ? artists.find((a) => a.id === artistId) : undefined

  const episodeGroups = groupShowItems(node, showItems)

  const root = topLevelAncestor(collections, collection.id)
  const similarShows = collections
    .filter((c) => c.browseAsShow && c.id !== collection.id)
    .filter((c) => {
      const cArtistId = resolveInheritedArtistId(collections, c.id)
      const cRoot = topLevelAncestor(collections, c.id)
      return (artistId != null && cArtistId === artistId) || (root != null && cRoot?.id === root.id)
    })
    .map((c) => {
      const cNode = findNodeById(tree, c.id)
      if (!cNode) return null
      const cDescendantIds = new Set(collectDescendantIds(cNode))
      const cItems = items.filter((i) => i.collectionId != null && cDescendantIds.has(i.collectionId))
      return buildShowSummary(c, cItems)
    })
    .filter((s): s is ShowSummary => s != null)

  const backTo = `/browse/collection/${collection.id}`

  return (
    <RevealAllProvider>
      <div className="space-y-8 pb-8">
        <div className="relative flex h-[40vh] min-h-56 w-full items-end overflow-hidden">
          {summary.coverUrl && !effectiveBlurred ? (
            <img src={summary.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <ImageIcon className="h-12 w-12 text-muted-foreground/40" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
          <div className="relative space-y-2 p-6 md:p-10">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {summary.itemCount} {summary.itemCount === 1 ? "item" : "items"}
            </p>
            <h1 className="max-w-xl text-2xl font-bold md:text-4xl">{summary.name}</h1>
          </div>
        </div>

        <div className="space-y-8 px-4 md:px-8">
          {artist && (
            <Link to={`/browse/artist/${artist.id}`} className="flex w-fit items-center gap-3 hover:opacity-80">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                {artist.selectedImagePath ? (
                  <img src={imageUrl(artist.selectedImagePath)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
                  </div>
                )}
              </div>
              <p className="text-[1.75rem] font-medium">{artist.name}</p>
            </Link>
          )}

          {episodeGroups.map((group) => (
            <section key={group.key} className="space-y-2">
              <h2 className="text-lg font-semibold">{group.label}</h2>
              <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-2">
                {group.items.map((item) => (
                  <LibraryItemStripTile
                    key={item.id}
                    item={item}
                    backTo={backTo}
                    basePath="/browse"
                    ignorePrivacy={ignorePrivacy}
                  />
                ))}
              </div>
            </section>
          ))}

          {showItems.length === 0 && <p className="text-sm text-muted-foreground">Nothing in this show yet.</p>}

          {similarShows.length > 0 && <BrowseShowRow title="Similar content" shows={similarShows} />}
        </div>
      </div>
    </RevealAllProvider>
  )
}

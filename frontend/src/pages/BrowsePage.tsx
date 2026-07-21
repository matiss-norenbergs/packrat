import { useSearchParams } from "react-router-dom"
import { Skeleton } from "@/components/ui/skeleton"
import { BrowseHero } from "@/components/browse/BrowseHero"
import { BrowseRow } from "@/components/browse/BrowseRow"
import { BrowseTile } from "@/components/browse/BrowseTile"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { useLibrary, useLibraryQuery, useUpdateLibraryProgress } from "@/hooks/useLibrary"
import { useCollections } from "@/hooks/useCollections"
import { useArtists } from "@/hooks/useArtists"
import { useSettings } from "@/hooks/useSettings"
import { buildCollectionTree, collectDescendantIds } from "@/lib/collectionTree"
import { sortLibraryItems } from "@/lib/libraryFilters"
import { isAudioFilename } from "@/lib/utils"

const RECENTLY_ADDED_COUNT = 24
const CONTINUE_WATCHING_COUNT = 24
// Artists with fewer items than this aren't worth a whole row of their own.
const MIN_ARTIST_ROW_SIZE = 2
// Below this, playback barely started — not worth resuming.
const CONTINUE_WATCHING_MIN_SECONDS = 5
// Above this fraction watched, treat it as finished rather than "in
// progress" — otherwise a video sits in Continue Watching forever after the
// credits roll, just because its position never technically hit the end.
const CONTINUE_WATCHING_MAX_FRACTION = 0.95

export function BrowsePage() {
  const [searchParams] = useSearchParams()
  const search = searchParams.get("q") ?? ""

  const { data: items, isLoading: itemsLoading } = useLibrary()
  const { data: collections, isLoading: collectionsLoading } = useCollections()
  const { data: artists, isLoading: artistsLoading } = useArtists()
  const { data: settings } = useSettings()
  const ignorePrivacy = settings?.browseIgnorePrivacy ?? false
  const searchResults = useLibraryQuery({ q: search, pageSize: 100 }, search.length > 0)
  const updateProgress = useUpdateLibraryProgress()
  // Resetting position to 0 both drops the item out of the Continue
  // Watching filter (below the min-seconds threshold) and makes the next
  // open of that item start over from the beginning, which is the correct
  // "forget this" semantics for an explicit remove.
  const removeFromContinueWatching = (id: number) => updateProgress.mutate({ id, positionSeconds: 0 })

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
  const hero = recentlyAdded.find((i) => ignorePrivacy || !i.blurred)

  // Video only — music has no "continue watching" concept, and
  // playbackPositionSeconds is never set for audio items in the first
  // place (see usePlaybackProgress).
  const continueWatching = items
    .filter(
      (i) =>
        !isAudioFilename(i.filename) &&
        i.playbackPositionSeconds != null &&
        i.playbackPositionSeconds >= CONTINUE_WATCHING_MIN_SECONDS &&
        (i.duration == null || i.playbackPositionSeconds < i.duration * CONTINUE_WATCHING_MAX_FRACTION) &&
        i.lastWatchedAt != null,
    )
    .sort((a, b) => new Date(b.lastWatchedAt!).getTime() - new Date(a.lastWatchedAt!).getTime())
    .slice(0, CONTINUE_WATCHING_COUNT)

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
          <BrowseRow
            title="Continue Watching"
            items={continueWatching}
            showProgress
            onRemoveItem={removeFromContinueWatching}
          />
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

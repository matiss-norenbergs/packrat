import { useSearchParams } from "react-router-dom"
import { Skeleton } from "@/components/ui/skeleton"
import { BrowseHero } from "@/components/browse/BrowseHero"
import { BrowseRow } from "@/components/browse/BrowseRow"
import { BrowseShowRow } from "@/components/browse/BrowseShowRow"
import { BrowseTile } from "@/components/browse/BrowseTile"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { useLibrary, useLibraryQuery, useUpdateLibraryProgress } from "@/hooks/useLibrary"
import { useCollections } from "@/hooks/useCollections"
import { useSettings } from "@/hooks/useSettings"
import {
  buildCollectionTree,
  collectDescendantIds,
  findNodeById,
  topLevelAncestor,
  type CollectionTreeNode,
} from "@/lib/collectionTree"
import { buildShowSummary, type ShowSummary } from "@/lib/browseShows"
import { sortLibraryItems } from "@/lib/libraryFilters"
import { isAudioFilename } from "@/lib/utils"

const RECENTLY_ADDED_COUNT = 24
const CONTINUE_WATCHING_COUNT = 24
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

  if (itemsLoading || collectionsLoading || !items || !collections) {
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

  const tree = buildCollectionTree(collections)

  // Any collection anywhere in the tree (not just roots) flagged
  // browseAsShow becomes one show/album tile grouping all its descendants'
  // items behind a single cover, instead of a flat row of per-item tiles —
  // flag the artist collection itself for "whole artist as one card", or
  // flag each album sub-collection instead for "one card per album".
  const flaggedIds = new Set(collections.filter((c) => c.browseAsShow).map((c) => c.id))

  const subtreeHasFlagged = (node: CollectionTreeNode): boolean =>
    flaggedIds.has(node.id) || node.children.some(subtreeHasFlagged)

  const showsByTopLevelRoot = new Map<number, { title: string; shows: ShowSummary[] }>()
  for (const collection of collections) {
    if (!collection.browseAsShow) continue
    const node = findNodeById(tree, collection.id)
    if (!node) continue
    const descendantIds = new Set(collectDescendantIds(node))
    const showItems = items.filter((i) => i.collectionId != null && descendantIds.has(i.collectionId))
    const root = topLevelAncestor(collections, collection.id)
    if (!root) continue
    const bucket = showsByTopLevelRoot.get(root.id) ?? { title: root.name, shows: [] }
    bucket.shows.push(buildShowSummary(collection, showItems))
    showsByTopLevelRoot.set(root.id, bucket)
  }
  // A top-level collection that is itself the only flagged show in its
  // subtree would otherwise get a row titled after itself containing one
  // tile captioned with that same name — a pointless duplicate ("Music"
  // header over a single "Music" tile). Pool every such solo, self-titled
  // root into one shared "Collections" row instead (not "Shows" — these
  // can just as easily be albums), sorted by name, and keep the per-root
  // grouping (with its own meaningful title) for roots that have several
  // flagged shows or a differently-named single sub-show.
  const showRows: { key: string; title: string; shows: ShowSummary[] }[] = []
  const soloShows: ShowSummary[] = []
  for (const [rootId, row] of showsByTopLevelRoot) {
    if (row.shows.length === 1 && row.shows[0].collectionId === rootId) {
      soloShows.push(row.shows[0])
    } else {
      showRows.push({ key: `show-row-${rootId}`, ...row })
    }
  }
  if (soloShows.length > 0) {
    soloShows.sort((a, b) => a.name.localeCompare(b.name))
    showRows.unshift({ key: "shows", title: "Collections", shows: soloShows })
  }

  // Fallback, unchanged from before: a top-level collection with no flagged
  // collection anywhere in its subtree keeps today's behavior — one row of
  // flat individual item tiles. Nothing regresses for collections not yet
  // opted into the new flag.
  const fallbackCollectionRows = tree
    .filter((root) => !subtreeHasFlagged(root))
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
          {showRows.map((row) => (
            <BrowseShowRow key={row.key} title={row.title} shows={row.shows} />
          ))}
          {fallbackCollectionRows.map((row) => (
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

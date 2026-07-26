import { useSearchParams } from "react-router-dom"
import { Skeleton } from "@/components/ui/skeleton"
import { BrowseHero } from "@/components/browse/BrowseHero"
import { BrowseRow } from "@/components/browse/BrowseRow"
import { BrowseShowRow } from "@/components/browse/BrowseShowRow"
import { BrowseTile } from "@/components/browse/BrowseTile"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { useLibraryQuery, useUpdateLibraryProgress } from "@/hooks/useLibrary"
import { useCollections } from "@/hooks/useCollections"
import { useSettings } from "@/hooks/useSettings"
import {
  buildCollectionTree,
  collectDescendantIds,
  topLevelAncestor,
  type CollectionTreeNode,
} from "@/lib/collectionTree"
import { buildShowSummary, type ShowSummary } from "@/lib/browseShows"

const RECENTLY_ADDED_COUNT = 24
const CONTINUE_WATCHING_COUNT = 24
// How many of the most-recently-added items the hero banner rotates
// through — deliberately smaller than RECENTLY_ADDED_COUNT itself, since at
// 10s/item a full cycle through 24 items would take 4 minutes; a shorter
// rotation reads as "freshly featured" rather than "the entire recent list."
const HERO_ROTATION_COUNT = 8
// Below this, playback barely started — not worth resuming. Mirrors the
// backend's InProgress filter (see continueWatchingMin/MaxFraction in
// library_repo.go); re-checked here too so an optimistic cache patch (e.g.
// "remove from Continue Watching" resetting position to 0) drops the row
// immediately instead of waiting on a refetch.
const CONTINUE_WATCHING_MIN_SECONDS = 5
const CONTINUE_WATCHING_MAX_FRACTION = 0.95

export function BrowsePage() {
  const [searchParams] = useSearchParams()
  const search = searchParams.get("q") ?? ""

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

  const recentlyAddedQuery = useLibraryQuery(
    { sortKey: "downloadedAt", sortDir: "desc", page: 1, pageSize: RECENTLY_ADDED_COUNT },
    !search,
  )
  const continueWatchingQuery = useLibraryQuery(
    { inProgress: true, sortKey: "lastWatchedAt", sortDir: "desc", page: 1, pageSize: CONTINUE_WATCHING_COUNT },
    !search,
  )

  const tree = collections ? buildCollectionTree(collections) : []

  // Any collection anywhere in the tree (not just roots) flagged
  // browseAsShow becomes one show/album tile grouping all its descendants'
  // items behind a single cover, instead of a flat row of per-item tiles —
  // flag the artist collection itself for "whole artist as one card", or
  // flag each album sub-collection instead for "one card per album".
  const flaggedIds = new Set((collections ?? []).filter((c) => c.browseAsShow).map((c) => c.id))

  const subtreeHasFlagged = (node: CollectionTreeNode): boolean =>
    flaggedIds.has(node.id) || node.children.some(subtreeHasFlagged)

  // Fallback roots (no flagged show anywhere in their subtree) need their
  // actual items fetched, scoped to just those subtrees — never the whole
  // library. Empty subtrees (totalItemCount already rolled up server-side)
  // are skipped before they ever cost a descendant-id resolution or a spot
  // in the fetch, so a collection with nothing in it never shows up here.
  const fallbackRoots = tree.filter((root) => !subtreeHasFlagged(root) && root.totalItemCount > 0)
  const fallbackDescendantIds = fallbackRoots.flatMap((root) => collectDescendantIds(root))
  const fallbackItemsQuery = useLibraryQuery(
    { collectionIds: fallbackDescendantIds, sortKey: "downloadedAt", sortDir: "desc" },
    !search && fallbackDescendantIds.length > 0,
  )

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

  if (collectionsLoading || recentlyAddedQuery.isLoading || !collections) {
    return (
      <div className="space-y-8 p-4 md:p-8">
        <Skeleton className="h-[50vh] min-h-72 w-full md:h-[60vh]" />
        <BrowseRowSkeleton />
        <BrowseRowSkeleton />
      </div>
    )
  }

  const recentlyAdded = recentlyAddedQuery.data?.items ?? []
  const heroItems = recentlyAdded.filter((i) => ignorePrivacy || !i.blurred).slice(0, HERO_ROTATION_COUNT)

  const continueWatching = (continueWatchingQuery.data?.items ?? []).filter(
    (i) =>
      i.playbackPositionSeconds != null &&
      i.playbackPositionSeconds >= CONTINUE_WATCHING_MIN_SECONDS &&
      (i.duration == null || i.playbackPositionSeconds < i.duration * CONTINUE_WATCHING_MAX_FRACTION),
  )

  // Shows/albums need no item fetch at all when they already have an
  // explicit cover — cover, name, and item count all come straight off the
  // collection response (see buildShowSummary). Subtrees with nothing in
  // them (totalItemCount === 0) are dropped rather than shown as an empty
  // card.
  const showsByTopLevelRoot = new Map<number, { title: string; shows: ShowSummary[] }>()
  for (const collection of collections) {
    if (!collection.browseAsShow || collection.totalItemCount === 0) continue
    const root = topLevelAncestor(collections, collection.id)
    if (!root) continue
    const bucket = showsByTopLevelRoot.get(root.id) ?? { title: root.name, shows: [] }
    bucket.shows.push(buildShowSummary(collection))
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
  // flat individual item tiles, sourced from the single scoped fetch above
  // (already sorted by downloadedAt desc) and split back out per root.
  const fallbackCollectionRows = fallbackRoots
    .map((root) => {
      const descendantIds = new Set(collectDescendantIds(root))
      const rowItems = (fallbackItemsQuery.data?.items ?? []).filter(
        (i) => i.collectionId != null && descendantIds.has(i.collectionId),
      )
      return { key: `collection-${root.id}`, title: root.name, items: rowItems }
    })
    .filter((row) => row.items.length > 0)

  return (
    <RevealAllProvider>
      <div className="space-y-8 pb-8">
        {heroItems.length > 0 && <BrowseHero items={heroItems} />}
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

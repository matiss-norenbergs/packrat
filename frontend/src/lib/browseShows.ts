import { imageUrl, mediaFileUrl } from "./api"
import { collectDescendantIds, type CollectionTreeNode } from "./collectionTree"
import { sortLibraryItems } from "./libraryFilters"
import type { Collection, LibraryItem } from "@/types/api"

// A "show/album" tile's display data — one per collection flagged
// browseAsShow, shared between BrowsePage's rows and BrowseShowPage's
// "similar content" row so the two never resolve a cover differently.
export interface ShowSummary {
  collectionId: number
  name: string
  coverUrl: string | null
  itemCount: number
  isPrivate: boolean
}

// Resolves what image represents a show/album tile: the collection's own
// explicitly chosen cover if set, else the most recently downloaded
// descendant item's thumbnail — the "default to the last downloaded file's
// image" fallback. Only falls through to the placeholder icon (coverUrl:
// null) when neither exists.
export function buildShowSummary(collection: Collection, showItems: LibraryItem[]): ShowSummary {
  const mostRecentWithThumb = sortLibraryItems(showItems, "downloadedAt", "desc").find((i) => i.thumbnail)
  const coverUrl = collection.coverImagePath
    ? imageUrl(collection.coverImagePath)
    : mostRecentWithThumb?.thumbnail
      ? mediaFileUrl(mostRecentWithThumb.thumbnail)
      : null
  return {
    collectionId: collection.id,
    name: collection.name,
    coverUrl,
    itemCount: showItems.length,
    isPrivate: collection.effectiveIsPrivate,
  }
}

// One labeled group of items in an episode/track listing — key is a stable
// React key, label is what's shown as the section heading.
export interface EpisodeGroup {
  key: string
  label: string
  items: LibraryItem[]
}

// Sorts within a group by episode/track (sequence) number, falling back to
// title — sortLibraryItems is single-key only, so grouping needs its own
// comparator rather than reusing it. Shared by every grouping mode below.
function compareBySequence(a: LibraryItem, b: LibraryItem): number {
  if (a.sequenceNumber != null && b.sequenceNumber != null) return a.sequenceNumber - b.sequenceNumber
  if (a.sequenceNumber != null) return -1
  if (b.sequenceNumber != null) return 1
  return a.title.localeCompare(b.title)
}

// Leaf-collection fallback: buckets by each item's own season number
// ascending, with unseasoned items collected last under a generic
// "Episodes" bucket.
function groupBySeason(items: LibraryItem[]): EpisodeGroup[] {
  const bySeason = new Map<number | null, LibraryItem[]>()
  for (const item of items) {
    const key = item.seasonNumber ?? null
    const bucket = bySeason.get(key)
    if (bucket) bucket.push(item)
    else bySeason.set(key, [item])
  }

  return Array.from(bySeason.entries())
    .map(([season, groupItems]) => ({
      key: season != null ? `season-${season}` : "episodes",
      label: season != null ? `Season ${season}` : "Episodes",
      season,
      items: [...groupItems].sort(compareBySequence),
    }))
    .sort((a, b) => {
      if (a.season == null) return 1
      if (b.season == null) return -1
      return a.season - b.season
    })
    .map(({ key, label, items }) => ({ key, label, items }))
}

// Groups a show's descendant items for the season/episode listing. When the
// clicked collection has direct sub-collections (e.g. "Season 1"/"Season 2"
// folders, or per-part folders), each becomes its own group — a more
// meaningful split than raw season numbers, since that's how the user
// actually organized the files. Falls back to groupBySeason (unchanged) for
// a leaf collection with no sub-collections.
export function groupShowItems(node: CollectionTreeNode, items: LibraryItem[]): EpisodeGroup[] {
  if (node.children.length === 0) {
    return groupBySeason(items)
  }

  // Ordered by the sub-collection's own seasonNumber when set — rather than
  // plain alphabetical, since "Season 10" must not sort before "Season 2" —
  // falling back to name for sub-collections that don't set one.
  const sortedChildren = [...node.children].sort((a, b) => {
    if (a.seasonNumber != null && b.seasonNumber != null) return a.seasonNumber - b.seasonNumber
    if (a.seasonNumber != null) return -1
    if (b.seasonNumber != null) return 1
    return a.name.localeCompare(b.name)
  })

  const claimedIds = new Set<number>()
  const groups: EpisodeGroup[] = []
  for (const child of sortedChildren) {
    const childDescendantIds = collectDescendantIds(child)
    for (const id of childDescendantIds) claimedIds.add(id)
    const childItems = items
      .filter((i) => i.collectionId != null && childDescendantIds.includes(i.collectionId))
      .sort(compareBySequence)
    if (childItems.length > 0) {
      groups.push({ key: `collection-${child.id}`, label: child.name, items: childItems })
    }
  }

  // Anything sitting directly on the clicked collection itself, not any
  // sub-collection — reuses the leaf case's "Episodes" label so this
  // catch-all bucket never gets confused for a real sub-collection.
  const leftover = items.filter((i) => i.collectionId != null && !claimedIds.has(i.collectionId)).sort(compareBySequence)
  if (leftover.length > 0) {
    groups.push({ key: "episodes", label: "Episodes", items: leftover })
  }

  return groups
}

// Groups an artist's items by the collection each one currently belongs to.
// An artist's items can span several unrelated shows/albums, so grouping by
// season number (meaningful only within one show) wouldn't make sense —
// grouping by owning collection is the moral equivalent for a page that
// isn't rooted at any single collection. Items with no collection land in a
// trailing "Uncategorized" bucket.
export function groupItemsByCollection(items: LibraryItem[]): EpisodeGroup[] {
  const byCollection = new Map<number | null, { name: string; items: LibraryItem[] }>()
  for (const item of items) {
    const key = item.collectionId ?? null
    const bucket = byCollection.get(key)
    if (bucket) bucket.items.push(item)
    else byCollection.set(key, { name: item.collectionName ?? "Uncategorized", items: [item] })
  }

  return Array.from(byCollection.entries())
    .map(([collectionId, { name, items: groupItems }]) => ({
      key: collectionId != null ? `collection-${collectionId}` : "uncategorized",
      label: name,
      collectionId,
      items: [...groupItems].sort(compareBySequence),
    }))
    .sort((a, b) => {
      if (a.collectionId == null) return 1
      if (b.collectionId == null) return -1
      return a.label.localeCompare(b.label)
    })
    .map(({ key, label, items }) => ({ key, label, items }))
}

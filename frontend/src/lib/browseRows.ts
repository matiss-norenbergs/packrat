// A Browse row is a horizontal strip nobody scrolls through to the end: Recently Added and Continue
// Watching show 24 tiles and search results 100. Each collection row loads its newest items only, at
// the search-results size, so a big collection no longer pulls its whole subtree into the page —
// collections of up to 100 items render exactly as before. Newest first (downloadedAt desc), so the
// cap only ever trims the oldest tail.
export const BROWSE_COLLECTION_ROW_COUNT = 100

export function browseCollectionRowParams(collectionIds: number[]) {
  return {
    collectionIds,
    sortKey: "downloadedAt" as const,
    sortDir: "desc" as const,
    page: 1,
    pageSize: BROWSE_COLLECTION_ROW_COUNT,
    hideGhosts: true,
  }
}

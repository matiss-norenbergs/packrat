import { describe, expect, it } from "vitest"
import { buildShowSummary, computeShowStats, groupItemsByCollection, groupShowItems } from "./browseShows"
import { buildCollectionTree } from "./collectionTree"
import type { Collection, LibraryItem } from "@/types/api"

function makeCollection(overrides: Partial<Collection> & { id: number; name: string }): Collection {
  return {
    parentId: null,
    rootPath: "",
    path: "",
    defaultQuality: "best",
    defaultDownloadType: "video",
    filenameTemplate: "",
    isPrivate: false,
    seasonNumber: null,
    artistId: null,
    coverImagePath: null,
    coverImageSmallPath: null,
    coverImageMediumPath: null,
    browseAsShow: false,
    itemCount: 0,
    effectiveIsPrivate: false,
    totalItemCount: 0,
    sequenceGaps: null,
    latestItemThumbnailPath: null,
    jellyfinLibraryId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

function makeItem(overrides: Partial<LibraryItem> & { id: number }): LibraryItem {
  return {
    downloadId: null,
    title: `Item ${overrides.id}`,
    filename: `item-${overrides.id}.mp4`,
    path: "",
    collectionId: null,
    collectionName: null,
    folder: "",
    originalUrl: null,
    uploader: null,
    duration: null,
    resolution: null,
    thumbnail: null,
    thumbnailSmallPath: null,
    thumbnailMediumPath: null,
    description: null,
    artistId: null,
    artistName: null,
    year: null,
    sequenceNumber: null,
    seasonNumber: null,
    generateNfo: false,
    nfoExists: false,
    downloadedAt: "2026-01-01T00:00:00Z",
    status: "completed",
    blurred: false,
    fileSizeBytes: null,
    tags: [],
    playbackPositionSeconds: null,
    lastWatchedAt: null,
    ...overrides,
  }
}

describe("buildShowSummary", () => {
  it("prefers the collection's own cover when set", () => {
    const summary = buildShowSummary(
      makeCollection({ id: 1, name: "Show", coverImagePath: "cover.jpg", totalItemCount: 12, effectiveIsPrivate: true }),
    )
    expect(summary.coverUrlSmall).toBe("/local-images/cover.jpg")
    expect(summary.coverUrlLarge).toBe("/local-images/cover.jpg")
    expect(summary.itemCount).toBe(12)
    expect(summary.isPrivate).toBe(true)
  })

  it("falls back to the latest item's thumbnail when there's no explicit cover", () => {
    const summary = buildShowSummary(makeCollection({ id: 1, name: "Show", latestItemThumbnailPath: "thumb.jpg" }))
    expect(summary.coverUrlSmall).toBe("/media-files/thumb.jpg")
    expect(summary.coverUrlLarge).toBe("/media-files/thumb.jpg")
  })

  it("returns null covers when neither a cover nor a fallback thumbnail exists", () => {
    const summary = buildShowSummary(makeCollection({ id: 1, name: "Show" }))
    expect(summary.coverUrlSmall).toBeNull()
    expect(summary.coverUrlLarge).toBeNull()
  })
})

describe("computeShowStats", () => {
  it("returns nulls/empty for no items", () => {
    expect(computeShowStats([])).toEqual({ yearRange: null, topTags: [] })
  })

  it("shows a single year when every item shares it", () => {
    const items = [makeItem({ id: 1, year: 2020 }), makeItem({ id: 2, year: 2020 })]
    expect(computeShowStats(items).yearRange).toBe("2020")
  })

  it("shows a min–max range across differing years", () => {
    const items = [makeItem({ id: 1, year: 2018 }), makeItem({ id: 2, year: 2022 }), makeItem({ id: 3, year: 2020 })]
    expect(computeShowStats(items).yearRange).toBe("2018–2022")
  })

  it("only surfaces tags meeting the minimum-occurrence floor, sorted by frequency, capped at 3", () => {
    const items = [
      ...Array.from({ length: 4 }, (_, i) => makeItem({ id: i, tags: ["comedy"] })),
      ...Array.from({ length: 3 }, (_, i) => makeItem({ id: i + 10, tags: ["action"] })),
      ...Array.from({ length: 2 }, (_, i) => makeItem({ id: i + 20, tags: ["drama"] })), // below the floor of 3
      ...Array.from({ length: 3 }, (_, i) => makeItem({ id: i + 30, tags: ["horror"] })),
      ...Array.from({ length: 3 }, (_, i) => makeItem({ id: i + 40, tags: ["sci-fi"] })),
    ]
    expect(computeShowStats(items).topTags).toEqual(["comedy", "action", "horror"])
  })
})

describe("groupShowItems — leaf collection (no sub-collections)", () => {
  const leaf = buildCollectionTree([makeCollection({ id: 1, name: "Leaf" })])[0]

  it("buckets by season, sorted ascending, with unseasoned items in a trailing 'Episodes' bucket", () => {
    const items = [
      makeItem({ id: 1, seasonNumber: 2, sequenceNumber: 1 }),
      makeItem({ id: 2, seasonNumber: null }),
      makeItem({ id: 3, seasonNumber: 1, sequenceNumber: 2 }),
      makeItem({ id: 4, seasonNumber: 1, sequenceNumber: 1 }),
    ]
    const groups = groupShowItems(leaf, items)
    expect(groups.map((g) => g.label)).toEqual(["Season 1", "Season 2", "Episodes"])
    expect(groups[0].items.map((i) => i.id)).toEqual([4, 3]) // sorted by sequenceNumber within the season
  })

  it("falls back to title when sequenceNumber is missing", () => {
    const items = [
      makeItem({ id: 1, title: "Zeta", seasonNumber: 1 }),
      makeItem({ id: 2, title: "Alpha", seasonNumber: 1 }),
    ]
    const groups = groupShowItems(leaf, items)
    expect(groups[0].items.map((i) => i.title)).toEqual(["Alpha", "Zeta"])
  })
})

describe("groupShowItems — collection with sub-collections", () => {
  const tree = buildCollectionTree([
    makeCollection({ id: 1, name: "Show" }),
    makeCollection({ id: 2, name: "Season 2", parentId: 1, seasonNumber: 2 }),
    makeCollection({ id: 3, name: "Season 1", parentId: 1, seasonNumber: 1 }),
  ])
  const show = tree[0]

  it("groups items by their owning sub-collection, ordered by the sub-collection's seasonNumber", () => {
    const items = [
      makeItem({ id: 1, collectionId: 2, sequenceNumber: 1 }),
      makeItem({ id: 2, collectionId: 3, sequenceNumber: 1 }),
    ]
    const groups = groupShowItems(show, items)
    expect(groups.map((g) => g.label)).toEqual(["Season 1", "Season 2"])
  })

  it("buckets items sitting directly on the parent (not any sub-collection) into a trailing 'Episodes' group", () => {
    const items = [
      makeItem({ id: 1, collectionId: 3, sequenceNumber: 1 }),
      makeItem({ id: 2, collectionId: 1, sequenceNumber: 1 }), // directly on "Show", not a season
    ]
    const groups = groupShowItems(show, items)
    expect(groups.map((g) => g.label)).toEqual(["Season 1", "Episodes"])
  })

  it("omits a sub-collection group entirely when it has no items", () => {
    const items = [makeItem({ id: 1, collectionId: 3, sequenceNumber: 1 })]
    const groups = groupShowItems(show, items)
    expect(groups.map((g) => g.label)).toEqual(["Season 1"])
  })
})

describe("groupItemsByCollection", () => {
  it("groups by collectionId, alphabetically, with 'Uncategorized' trailing", () => {
    const items = [
      makeItem({ id: 1, collectionId: 2, collectionName: "Zebra Album" }),
      makeItem({ id: 2, collectionId: null }),
      makeItem({ id: 3, collectionId: 1, collectionName: "Apple Album" }),
    ]
    const groups = groupItemsByCollection(items)
    expect(groups.map((g) => g.label)).toEqual(["Apple Album", "Zebra Album", "Uncategorized"])
  })
})

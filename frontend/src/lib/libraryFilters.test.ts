import { describe, expect, it } from "vitest"
import { sortLibraryItems } from "./libraryFilters"
import type { LibraryItem } from "@/types/api"

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

describe("sortLibraryItems", () => {
  it("sorts by title ascending/descending", () => {
    const items = [makeItem({ id: 1, title: "Banana" }), makeItem({ id: 2, title: "Apple" })]
    expect(sortLibraryItems(items, "title", "asc").map((i) => i.title)).toEqual(["Apple", "Banana"])
    expect(sortLibraryItems(items, "title", "desc").map((i) => i.title)).toEqual(["Banana", "Apple"])
  })

  it("sorts nulls last regardless of direction", () => {
    const items = [makeItem({ id: 1, year: 2020 }), makeItem({ id: 2, year: null }), makeItem({ id: 3, year: 2010 })]
    expect(sortLibraryItems(items, "year", "asc").map((i) => i.id)).toEqual([3, 1, 2])
    // Descending reverses the *non-null* ordering (2020 before 2010) but the
    // null still lands last, not first — this is the regression this test
    // guards against (see libraryFilters.ts's compareValues comment).
    expect(sortLibraryItems(items, "year", "desc").map((i) => i.id)).toEqual([1, 3, 2])
  })

  it("breaks a seasonNumber tie using sequenceNumber", () => {
    const items = [
      makeItem({ id: 1, seasonNumber: 1, sequenceNumber: 3 }),
      makeItem({ id: 2, seasonNumber: 1, sequenceNumber: 1 }),
      makeItem({ id: 3, seasonNumber: 2, sequenceNumber: 1 }),
    ]
    expect(sortLibraryItems(items, "seasonNumber", "asc").map((i) => i.id)).toEqual([2, 1, 3])
  })

  it("falls back to downloadedAt for an unrecognized/default sort key", () => {
    const items = [
      makeItem({ id: 1, downloadedAt: "2026-01-02T00:00:00Z" }),
      makeItem({ id: 2, downloadedAt: "2026-01-01T00:00:00Z" }),
    ]
    expect(sortLibraryItems(items, "downloadedAt", "asc").map((i) => i.id)).toEqual([2, 1])
  })

  it("does not mutate the input array", () => {
    const items = [makeItem({ id: 1, title: "Banana" }), makeItem({ id: 2, title: "Apple" })]
    const original = [...items]
    sortLibraryItems(items, "title", "asc")
    expect(items).toEqual(original)
  })
})

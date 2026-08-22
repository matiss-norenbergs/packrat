import { describe, expect, it } from "vitest"
import {
  artistIdToSelectValue,
  baseNameWithoutExt,
  buildLibraryItemUpdatePayload,
  libraryItemToEditFields,
} from "./libraryItemEdit"
import type { LibraryItem } from "@/types/api"

function makeItem(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 1,
    downloadId: null,
    title: "Original Title",
    filename: "original.mp4",
    path: "",
    collectionId: null,
    collectionName: null,
    folder: "",
    originalUrl: "https://example.com/video",
    uploader: "Original Uploader",
    duration: null,
    resolution: null,
    mediaType: null,
    thumbnail: null,
    thumbnailSmallPath: null,
    thumbnailMediumPath: null,
    description: "Original description",
    artistId: 7,
    artistName: "Some Artist",
    year: 2020,
    sequenceNumber: 3,
    seasonNumber: 1,
    generateNfo: false,
    nfoExists: false,
    downloadedAt: "2026-01-01T00:00:00Z",
    status: "completed",
    blurred: false,
    fileSizeBytes: null,
    tags: ["a", "b"],
    playbackPositionSeconds: null,
    lastWatchedAt: null,
    galleryCount: 0,
    thumbnailWidth: null,
    thumbnailHeight: null,
    ...overrides,
  }
}

describe("baseNameWithoutExt", () => {
  it("strips a simple extension", () => {
    expect(baseNameWithoutExt("video.mp4")).toBe("video")
  })

  it("strips only the last extension from a multi-dot filename", () => {
    expect(baseNameWithoutExt("archive.tar.gz")).toBe("archive.tar")
  })

  it("leaves a filename with no extension untouched", () => {
    expect(baseNameWithoutExt("no-extension")).toBe("no-extension")
  })

  it("treats a leading dot as not an extension separator", () => {
    expect(baseNameWithoutExt(".hidden")).toBe(".hidden")
  })
})

describe("artistIdToSelectValue", () => {
  it("maps null to the NO_ARTIST sentinel", () => {
    expect(artistIdToSelectValue(null)).toBe("none")
  })

  it("maps a real id to its string form", () => {
    expect(artistIdToSelectValue(5)).toBe("5")
  })
})

describe("libraryItemToEditFields", () => {
  it("maps null/optional fields to empty strings", () => {
    const fields = libraryItemToEditFields(makeItem({ uploader: null, description: null, originalUrl: null, year: null }))
    expect(fields.uploader).toBe("")
    expect(fields.description).toBe("")
    expect(fields.originalUrl).toBe("")
    expect(fields.year).toBe("")
  })

  it("strips the extension off the filename", () => {
    expect(libraryItemToEditFields(makeItem({ filename: "video.mkv" })).filename).toBe("video")
  })
})

describe("buildLibraryItemUpdatePayload", () => {
  it("returns an empty payload when nothing changed", () => {
    const item = makeItem()
    const fields = libraryItemToEditFields(item)
    expect(buildLibraryItemUpdatePayload(item, fields)).toEqual({})
  })

  it("includes only the changed fields", () => {
    const item = makeItem()
    const fields = libraryItemToEditFields(item)
    fields.title = "New Title"
    expect(buildLibraryItemUpdatePayload(item, fields)).toEqual({ title: "New Title" })
  })

  it("omits title when trimmed to empty", () => {
    const item = makeItem()
    const fields = libraryItemToEditFields(item)
    fields.title = "   "
    expect(buildLibraryItemUpdatePayload(item, fields)).toEqual({})
  })

  it("maps an emptied numeric field to the 0 clear-sentinel", () => {
    const item = makeItem({ year: 2020 })
    const fields = libraryItemToEditFields(item)
    fields.year = ""
    expect(buildLibraryItemUpdatePayload(item, fields)).toEqual({ year: 0 })
  })

  it("does not send year when it's unchanged", () => {
    const item = makeItem({ year: null })
    const fields = libraryItemToEditFields(item)
    expect(fields.year).toBe("")
    expect(buildLibraryItemUpdatePayload(item, fields).year).toBeUndefined()
  })

  it("maps NO_ARTIST back to 0, and a real selection to its number", () => {
    const item = makeItem({ artistId: 7 })
    const fields = libraryItemToEditFields(item)
    fields.artistId = "none"
    expect(buildLibraryItemUpdatePayload(item, fields)).toEqual({ artistId: 0 })

    fields.artistId = "9"
    expect(buildLibraryItemUpdatePayload(item, fields)).toEqual({ artistId: 9 })
  })

  it("treats reordered tags as unchanged", () => {
    const item = makeItem({ tags: ["a", "b"] })
    const fields = libraryItemToEditFields(item)
    fields.tags = ["b", "a"]
    expect(buildLibraryItemUpdatePayload(item, fields).tags).toBeUndefined()
  })

  it("detects an actual tag set change", () => {
    const item = makeItem({ tags: ["a", "b"] })
    const fields = libraryItemToEditFields(item)
    fields.tags = ["a", "c"]
    expect(buildLibraryItemUpdatePayload(item, fields)).toEqual({ tags: ["a", "c"] })
  })

  it("detects a generateNfo toggle", () => {
    const item = makeItem({ generateNfo: false })
    const fields = libraryItemToEditFields(item)
    fields.generateNfo = true
    expect(buildLibraryItemUpdatePayload(item, fields)).toEqual({ generateNfo: true })
  })
})

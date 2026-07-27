import { describe, expect, it } from "vitest"
import {
  buildCollectionTree,
  collectDescendantIds,
  findNodeById,
  resolveInheritedArtistId,
  topLevelAncestor,
} from "./collectionTree"
import type { Collection } from "@/types/api"

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

describe("buildCollectionTree", () => {
  const collections = [
    makeCollection({ id: 1, name: "Zebra", parentId: null }),
    makeCollection({ id: 2, name: "Apple", parentId: null }),
    makeCollection({ id: 3, name: "Child B", parentId: 1 }),
    makeCollection({ id: 4, name: "Child A", parentId: 1 }),
    makeCollection({ id: 5, name: "Orphan", parentId: 999 }), // parent doesn't exist
  ]
  const tree = buildCollectionTree(collections)

  it("nests children under their parent", () => {
    const zebra = tree.find((n) => n.id === 1)
    expect(zebra?.children.map((c) => c.id)).toEqual([4, 3]) // sorted: "Child A" before "Child B"
  })

  it("promotes a node whose parentId doesn't resolve to a root", () => {
    expect(tree.some((n) => n.id === 5)).toBe(true)
  })

  it("sorts every level alphabetically by name", () => {
    expect(tree.map((n) => n.name)).toEqual(["Apple", "Orphan", "Zebra"])
  })
})

describe("findNodeById", () => {
  const tree = buildCollectionTree([
    makeCollection({ id: 1, name: "Root" }),
    makeCollection({ id: 2, name: "Nested", parentId: 1 }),
  ])

  it("finds a root-level node", () => {
    expect(findNodeById(tree, 1)?.name).toBe("Root")
  })

  it("finds a nested node", () => {
    expect(findNodeById(tree, 2)?.name).toBe("Nested")
  })

  it("returns null for an id that doesn't exist", () => {
    expect(findNodeById(tree, 999)).toBeNull()
  })
})

describe("collectDescendantIds", () => {
  const tree = buildCollectionTree([
    makeCollection({ id: 1, name: "Root" }),
    makeCollection({ id: 2, name: "Child", parentId: 1 }),
    makeCollection({ id: 3, name: "Grandchild", parentId: 2 }),
    makeCollection({ id: 4, name: "Other Root" }),
  ])

  it("includes the node itself plus every nested descendant", () => {
    const root = findNodeById(tree, 1)!
    expect(collectDescendantIds(root).sort()).toEqual([1, 2, 3])
  })

  it("returns just itself for a leaf with no children", () => {
    const other = findNodeById(tree, 4)!
    expect(collectDescendantIds(other)).toEqual([4])
  })
})

describe("resolveInheritedArtistId", () => {
  const collections = [
    makeCollection({ id: 1, name: "Artist Root", artistId: 42 }),
    makeCollection({ id: 2, name: "Season 1", parentId: 1 }),
    makeCollection({ id: 3, name: "No Artist Root" }),
  ]

  it("returns the collection's own artistId when set directly", () => {
    expect(resolveInheritedArtistId(collections, 1)).toBe(42)
  })

  it("inherits an ancestor's artistId when the collection has none of its own", () => {
    expect(resolveInheritedArtistId(collections, 2)).toBe(42)
  })

  it("returns null when nothing in the chain has an artistId", () => {
    expect(resolveInheritedArtistId(collections, 3)).toBeNull()
  })

  it("returns null for a null collectionId", () => {
    expect(resolveInheritedArtistId(collections, null)).toBeNull()
  })
})

describe("topLevelAncestor", () => {
  const collections = [
    makeCollection({ id: 1, name: "Root" }),
    makeCollection({ id: 2, name: "Mid", parentId: 1 }),
    makeCollection({ id: 3, name: "Leaf", parentId: 2 }),
  ]

  it("walks all the way up to the collection with no parent", () => {
    expect(topLevelAncestor(collections, 3)?.id).toBe(1)
  })

  it("returns the collection itself when it's already top-level", () => {
    expect(topLevelAncestor(collections, 1)?.id).toBe(1)
  })

  it("returns null when the id isn't in the list at all", () => {
    expect(topLevelAncestor(collections, 999)).toBeNull()
  })
})

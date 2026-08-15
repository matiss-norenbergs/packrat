import { describe, expect, it } from "vitest"
import {
  buildCollectionTree,
  collectDescendantIds,
  filterCollectionTree,
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
    year: null,
    sequenceMin: null,
    sequenceMax: null,
    artistId: null,
    coverImagePath: null,
    coverImageSmallPath: null,
    coverImageMediumPath: null,
    browseAsShow: false,
    itemCount: 0,
    effectiveIsPrivate: false,
    totalItemCount: 0,
    ghostItemCount: 0,
    totalGhostItemCount: 0,
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

describe("filterCollectionTree", () => {
  const tree = buildCollectionTree([
    makeCollection({ id: 1, name: "Music" }),
    makeCollection({ id: 2, name: "Rock", parentId: 1 }),
    makeCollection({ id: 3, name: "Jazz", parentId: 1 }),
    makeCollection({ id: 4, name: "Movies" }),
    makeCollection({ id: 5, name: "Comedy", parentId: 4 }),
  ])

  it("returns the tree unchanged and no forced expansion for an empty query", () => {
    const result = filterCollectionTree(tree, "")
    expect(result.tree).toBe(tree)
    expect(result.matchAncestorIds.size).toBe(0)
  })

  it("returns the tree unchanged for a whitespace-only query", () => {
    expect(filterCollectionTree(tree, "   ").tree).toBe(tree)
  })

  it("keeps a matching leaf and prunes non-matching siblings", () => {
    const result = filterCollectionTree(tree, "rock")
    expect(result.tree.map((n) => n.name)).toEqual(["Music"])
    expect(result.tree[0].children.map((n) => n.name)).toEqual(["Rock"])
  })

  it("marks the matched leaf's ancestors for forced expansion, not the leaf itself", () => {
    const result = filterCollectionTree(tree, "rock")
    expect(result.matchAncestorIds.has(1)).toBe(true)
    expect(result.matchAncestorIds.has(2)).toBe(false)
  })

  it("drops a whole branch when neither it nor any descendant matches", () => {
    const result = filterCollectionTree(tree, "ck")
    // Only "Rock" contains "ck" — Jazz is pruned from Music, and Movies (no
    // matching descendant at all) is dropped entirely.
    expect(result.tree.map((n) => n.name)).toEqual(["Music"])
    expect(result.tree[0].children.map((n) => n.name)).toEqual(["Rock"])
  })

  it("keeps multiple separate top-level branches when each has its own match", () => {
    const multiTree = buildCollectionTree([
      makeCollection({ id: 1, name: "Alpha" }),
      makeCollection({ id: 2, name: "Alpha Target", parentId: 1 }),
      makeCollection({ id: 3, name: "Beta" }),
      makeCollection({ id: 4, name: "Beta Target", parentId: 3 }),
      makeCollection({ id: 5, name: "Gamma" }),
      makeCollection({ id: 6, name: "Gamma Nope", parentId: 5 }),
    ])
    const result = filterCollectionTree(multiTree, "target")
    expect(result.tree.map((n) => n.name)).toEqual(["Alpha", "Beta"])
  })

  it("matches case-insensitively", () => {
    expect(filterCollectionTree(tree, "MUSIC").tree.map((n) => n.name)).toEqual(["Music"])
  })

  it("returns an empty tree when nothing matches", () => {
    const result = filterCollectionTree(tree, "nonexistent")
    expect(result.tree).toEqual([])
    expect(result.matchAncestorIds.size).toBe(0)
  })

  it("keeps a matching parent's own match without requiring its children to match too", () => {
    const result = filterCollectionTree(tree, "movies")
    expect(result.tree.map((n) => n.name)).toEqual(["Movies"])
    expect(result.tree[0].children).toEqual([])
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

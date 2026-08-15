import type { Collection } from "@/types/api"

export interface CollectionTreeNode extends Collection {
  children: CollectionTreeNode[]
}

export function buildCollectionTree(collections: Collection[]): CollectionTreeNode[] {
  const nodes = new Map<number, CollectionTreeNode>()
  for (const c of collections) {
    nodes.set(c.id, { ...c, children: [] })
  }

  const roots: CollectionTreeNode[] = []
  for (const node of nodes.values()) {
    if (node.parentId != null && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortByName = (a: CollectionTreeNode, b: CollectionTreeNode) => a.name.localeCompare(b.name)
  const sortTree = (list: CollectionTreeNode[]) => {
    list.sort(sortByName)
    for (const node of list) sortTree(node.children)
  }
  sortTree(roots)

  return roots
}

export function findNodeById(nodes: CollectionTreeNode[], id: number): CollectionTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNodeById(node.children, id)
    if (found) return found
  }
  return null
}

// Self + every nested descendant id — used to resolve a bulk-selected folder
// into the full set of collection ids whose files should be included (folder
// selection is recursive, see the Library bulk-edit plan's edge case #1).
export function collectDescendantIds(node: CollectionTreeNode): number[] {
  const ids = [node.id]
  for (const child of node.children) {
    ids.push(...collectDescendantIds(child))
  }
  return ids
}

// Walks from collectionId up through parentId, returning the nearest
// artistId found (checking the collection itself first, then each ancestor
// in turn) — unlike seasonNumber (deliberately direct-only, see the
// collection season feature), a collection's artist is meant to be set once
// on a top-level "Artist Name" folder and inherited by every season/other
// sub-collection nested under it, since a real layout is often
// root/some-folder/artist/season/file. Returns null if collectionId is null
// or nothing in the chain up to the root has an artist set.
export function resolveInheritedArtistId(collections: Collection[], collectionId: number | null): number | null {
  if (collectionId == null) return null
  const byId = new Map(collections.map((c) => [c.id, c]))
  let current = byId.get(collectionId)
  while (current) {
    if (current.artistId != null) return current.artistId
    current = current.parentId != null ? byId.get(current.parentId) : undefined
  }
  return null
}

// Alphabetical by full path — the same text every collection-picking Select
// displays, so the on-screen order actually matches what's printed (the
// backend's own ORDER BY name sorts by leaf name only, which can look
// inconsistent once the label shown is the full path).
export function sortCollectionsByPath<T extends { path: string }>(collections: T[]): T[] {
  return [...collections].sort((a, b) => a.path.localeCompare(b.path))
}

export interface CollectionTreeFilterResult {
  tree: CollectionTreeNode[]
  // Ids of nodes kept only because a descendant matched — the caller force-
  // expands these while a search is active so a nested match isn't hidden
  // behind a collapsed ancestor, without touching the persisted expand state
  // a plain Expand all/Collapse all toggle relies on.
  matchAncestorIds: Set<number>
}

// Prunes the tree down to nodes whose name matches the query plus the
// ancestor chain needed to reach them — siblings and descendants that don't
// themselves match are dropped, the same "show the path to a hit, nothing
// else" behavior a file-search tree uses. An empty/whitespace-only query is
// a no-op (returns the tree unchanged, no forced expansion).
export function filterCollectionTree(nodes: CollectionTreeNode[], query: string): CollectionTreeFilterResult {
  const q = query.trim().toLowerCase()
  if (!q) return { tree: nodes, matchAncestorIds: new Set() }

  const matchAncestorIds = new Set<number>()

  const filterNode = (node: CollectionTreeNode): CollectionTreeNode | null => {
    const children = node.children.map(filterNode).filter((n): n is CollectionTreeNode => n !== null)
    const selfMatches = node.name.toLowerCase().includes(q)
    if (!selfMatches && children.length === 0) return null
    if (children.length > 0) matchAncestorIds.add(node.id)
    return { ...node, children }
  }

  const tree = nodes.map(filterNode).filter((n): n is CollectionTreeNode => n !== null)
  return { tree, matchAncestorIds }
}

// Walks up parentId to the collection with no parent (or whose parent isn't
// in the list) — used to bucket flagged "show" collections into one Browse
// row per top-level ancestor, so e.g. several artists/albums nested under
// one "Music" root land in a single "Music" row together. Returns null only
// if collectionId isn't present in collections at all.
export function topLevelAncestor(collections: Collection[], collectionId: number): Collection | null {
  const byId = new Map(collections.map((c) => [c.id, c]))
  let current = byId.get(collectionId)
  if (!current) return null
  while (current.parentId != null && byId.has(current.parentId)) {
    current = byId.get(current.parentId)!
  }
  return current
}

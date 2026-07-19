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

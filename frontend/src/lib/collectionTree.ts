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

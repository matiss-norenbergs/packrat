import { useState } from "react"
import { ChevronDown, ChevronRight, FolderPlus, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { CollectionDialog } from "./CollectionDialog"
import { useDeleteCollection } from "@/hooks/useCollections"
import type { CollectionTreeNode } from "@/lib/collectionTree"

export function CollectionTree({ nodes }: { nodes: CollectionTreeNode[] }) {
  return (
    <div className="space-y-2">
      {nodes.map((node) => (
        <CollectionNode key={node.id} node={node} />
      ))}
    </div>
  )
}

function CollectionNode({ node }: { node: CollectionTreeNode }) {
  const [expanded, setExpanded] = useState(true)
  const deleteCollection = useDeleteCollection()
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div className="flex items-center gap-2 rounded-md border p-3">
        {hasChildren ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        ) : (
          <span className="w-6 shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{node.name}</span>
            <Badge variant="outline">{node.defaultDownloadType}</Badge>
            <Badge variant="outline">{node.defaultQuality}</Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">Folder: {node.rootPath}</p>
        </div>

        <div className="flex shrink-0 gap-1">
          <CollectionDialog
            parentId={node.id}
            trigger={
              <Button variant="ghost" size="icon" title="Add sub-collection">
                <FolderPlus className="h-4 w-4" />
              </Button>
            }
          />
          <CollectionDialog
            collection={node}
            trigger={
              <Button variant="ghost" size="icon" title="Edit">
                <Pencil className="h-4 w-4" />
              </Button>
            }
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" title="Delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{node.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  Existing downloads and library items in this collection become uncategorized —
                  they are not deleted. Sub-collections must be moved or deleted first.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteCollection.mutate(node.id)}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {hasChildren && expanded && (
        <div className="ml-6 mt-2 space-y-2 border-l pl-4">
          {node.children.map((child) => (
            <CollectionNode key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  )
}

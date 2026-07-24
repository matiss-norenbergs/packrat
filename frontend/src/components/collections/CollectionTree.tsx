import { useState } from "react"
import { ChevronDown, ChevronRight, FolderPlus, Info, Lock, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CollectionDialog } from "./CollectionDialog"
import { useDeleteCollection } from "@/hooks/useCollections"
import { useArtists } from "@/hooks/useArtists"
import type { CollectionTreeNode } from "@/lib/collectionTree"

interface SelectionProps {
  isSelected: (id: number) => boolean
  onToggle: (id: number) => void
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s
}

export function CollectionTree({ nodes, isSelected, onToggle }: { nodes: CollectionTreeNode[] } & SelectionProps) {
  const { data: artists } = useArtists()
  const artistNameById = new Map((artists ?? []).map((a) => [a.id, a.name]))

  return (
    <div className="space-y-2">
      {nodes.map((node) => (
        <CollectionNode
          key={node.id}
          node={node}
          isSelected={isSelected}
          onToggle={onToggle}
          artistNameById={artistNameById}
        />
      ))}
    </div>
  )
}

function CollectionNode({
  node,
  isSelected,
  onToggle,
  artistNameById,
}: { node: CollectionTreeNode; artistNameById: Map<number, string> } & SelectionProps) {
  const [expanded, setExpanded] = useState(true)
  const deleteCollection = useDeleteCollection()
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
        <Checkbox checked={isSelected(node.id)} onCheckedChange={() => onToggle(node.id)} />

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
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{node.name}</span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  title="Collection details"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="start">
                <dl className="space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">Folder</dt>
                    <dd className="min-w-0 truncate">{node.rootPath}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">Type</dt>
                    <dd>{capitalize(node.defaultDownloadType)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">Quality</dt>
                    <dd>{capitalize(node.defaultQuality)}</dd>
                  </div>
                  {node.artistId != null && artistNameById.has(node.artistId) && (
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">Artist</dt>
                      <dd className="min-w-0 truncate">{artistNameById.get(node.artistId)}</dd>
                    </div>
                  )}
                  {node.seasonNumber != null && (
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">Season</dt>
                      <dd>{node.seasonNumber}</dd>
                    </div>
                  )}
                </dl>
              </PopoverContent>
            </Popover>
            {node.isPrivate && (
              <span title="Private">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{node.itemCount} {node.itemCount === 1 ? "file" : "files"}</Badge>
          </div>
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
            <CollectionNode
              key={child.id}
              node={child}
              isSelected={isSelected}
              onToggle={onToggle}
              artistNameById={artistNameById}
            />
          ))}
        </div>
      )}
    </div>
  )
}

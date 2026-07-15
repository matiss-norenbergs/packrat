import { Folder, Lock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { useSettings } from "@/hooks/useSettings"
import type { CollectionTreeNode } from "@/lib/collectionTree"
import { cn } from "@/lib/utils"
import { useSelection } from "./SelectionContext"

export function CollectionFolderTile({ node, onClick }: { node: CollectionTreeNode; onClick: () => void }) {
  const { data: settings } = useSettings()
  const mode = (settings?.libraryMode as "manage" | "details") || "manage"
  const { selectionActive, isCollectionSelected, toggleCollection } = useSelection()
  const selected = isCollectionSelected(node.id)

  // While a selection is in progress, the tile body toggles the collection
  // instead of navigating in — mirrors LibraryCard's click-anywhere-to-select
  // behavior and stops an accidental navigation mid-selection.
  const handleActivate = () => {
    if (selectionActive) toggleCollection(node.id, node.totalItemCount)
    else onClick()
  }

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={(e) => (e.key === "Enter" ? handleActivate() : undefined)}
      className="group relative cursor-pointer transition hover:ring-2 hover:ring-primary"
    >
      {mode === "manage" && (
        <Checkbox
          checked={selected}
          onCheckedChange={() => toggleCollection(node.id, node.totalItemCount)}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "absolute top-2 left-2 z-10 size-5 rounded-full transition-opacity",
            selectionActive || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          aria-label="Select collection"
        />
      )}
      <CardContent className="flex items-center gap-3 p-4">
        <Folder className="h-8 w-8 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium">{node.name}</p>
            {node.isPrivate && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
          </div>
          <p className="text-xs text-muted-foreground">
            {node.children.length} {node.children.length === 1 ? "subcollection" : "subcollections"}
          </p>
          <p className="text-xs text-muted-foreground">
            {node.itemCount} {node.itemCount === 1 ? "file" : "files"}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

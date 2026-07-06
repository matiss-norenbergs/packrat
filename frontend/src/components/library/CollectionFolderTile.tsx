import { Folder, Lock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { CollectionTreeNode } from "@/lib/collectionTree"

export function CollectionFolderTile({ node, onClick }: { node: CollectionTreeNode; onClick: () => void }) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" ? onClick() : undefined)}
      className="cursor-pointer transition hover:ring-2 hover:ring-primary"
    >
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

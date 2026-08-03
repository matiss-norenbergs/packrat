import { useState } from "react"
import { AlertTriangle, Folder, Lock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useSettings } from "@/hooks/useSettings"
import type { CollectionTreeNode } from "@/lib/collectionTree"
import { cn } from "@/lib/utils"
import { useSelection } from "./SelectionContext"

export function CollectionFolderTile({ node, onClick }: { node: CollectionTreeNode; onClick: () => void }) {
  const { data: settings } = useSettings()
  const mode = (settings?.libraryMode as "manage" | "details") || "manage"
  const { selectionActive, isCollectionSelected, toggleCollection } = useSelection()
  const selected = isCollectionSelected(node.id)
  // Controlled instead of Radix's default click/focus trigger — Popover has
  // no built-in hover mode, so open/close is driven manually here. Both the
  // trigger and the content itself need the enter/leave handlers, or moving
  // the mouse off the small icon and onto the content (e.g. to read a long
  // missing-numbers list) would immediately close it.
  const [gapPopoverOpen, setGapPopoverOpen] = useState(false)

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
            {settings?.privacyEnabled && node.isPrivate && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
          </div>
          <p className="text-xs text-muted-foreground">
            {node.children.length} {node.children.length === 1 ? "subcollection" : "subcollections"}
          </p>
          <div className="flex items-center gap-1">
            <p className="text-xs text-muted-foreground">
              {node.itemCount} {node.itemCount === 1 ? "file" : "files"}
            </p>
            {node.sequenceGaps && (
              <Popover open={gapPopoverOpen} onOpenChange={setGapPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="text-amber-600 dark:text-amber-500"
                    aria-label="Missing sequence numbers"
                    onClick={(e) => e.stopPropagation()}
                    onMouseEnter={() => setGapPopoverOpen(true)}
                    onMouseLeave={() => setGapPopoverOpen(false)}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="text-xs text-muted-foreground"
                  onClick={(e) => e.stopPropagation()}
                  onMouseEnter={() => setGapPopoverOpen(true)}
                  onMouseLeave={() => setGapPopoverOpen(false)}
                >
                  Missing seq: {node.sequenceGaps.missing.slice(0, 10).join(", ")}
                  {node.sequenceGaps.count > 10 ? ` (+${node.sequenceGaps.count - 10} more)` : ""}
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

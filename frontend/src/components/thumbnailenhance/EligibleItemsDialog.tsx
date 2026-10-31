import { useMemo } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Link } from "react-router-dom"
import { DataTable } from "@/components/data-table"
import type { ColumnDef } from "@/components/data-table"
import { useEnhanceThumbnailItems, useThumbnailEnhancementEligible } from "@/hooks/useThumbnailEnhancement"
import { useIdSelection } from "@/hooks/useIdSelection"
import type { ThumbnailEnhancementEligibleItem } from "@/types/api"

interface EligibleItemsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

const ITEM_LABEL = { singular: "item", plural: "items" }
const noop = () => {}

const getItemId = (item: ThumbnailEnhancementEligibleItem) => item.libraryItemId
const getItemLabel = (item: ThumbnailEnhancementEligibleItem) => `Select ${item.itemTitle}`

const columns: ColumnDef<ThumbnailEnhancementEligibleItem>[] = [
  {
    key: "item",
    header: "Item",
    cellClassName: "max-w-[280px] truncate",
    cell: (item) => (
      <Link to={`/library/${item.libraryItemId}`} className="font-medium underline-offset-2 hover:underline">
        {item.itemTitle}
      </Link>
    ),
  },
  { key: "artist", header: "Artist", cellClassName: "text-muted-foreground", cell: (item) => item.artistName ?? "—" },
  { key: "collection", header: "Collection", cellClassName: "text-muted-foreground", cell: (item) => item.collectionName ?? "—" },
  {
    key: "dimensions",
    header: "Dimensions",
    type: "number",
    cellClassName: "text-muted-foreground",
    cell: (item) => `${item.width}×${item.height}`,
  },
  {
    key: "status",
    header: "Status",
    type: "status",
    cell: (item) =>
      item.isProcessing ? (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Enhancing…
        </Badge>
      ) : item.recentlyFailedAt ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="destructive" className="cursor-default">
              Recently failed
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Failed {timeAgo(item.recentlyFailedAt)} — skipped from automatic runs, still retryable here.</TooltipContent>
        </Tooltip>
      ) : null,
  },
]

const loadingContent = (
  <div className="space-y-1 p-2">
    {Array.from({ length: 4 }).map((_, i) => (
      <Skeleton key={i} className="h-10 w-full rounded-md" />
    ))}
  </div>
)

export function EligibleItemsDialog({ open, onOpenChange }: EligibleItemsDialogProps) {
  const { data: items, isLoading } = useThumbnailEnhancementEligible(open)
  const enhanceItems = useEnhanceThumbnailItems()
  const selection = useIdSelection<number>()

  // Every eligible item is on one page ("select all" must cover the whole backlog); a single-page pagination config
  // gives the standard footer ("N items · M selected") without client-mode paging.
  const count = items?.length ?? 0
  const pagination = useMemo(
    () => ({ page: 1, pageSize: Math.max(1, count), total: count, onPageChange: noop, itemLabel: ITEM_LABEL }),
    [count],
  )

  const handleEnhanceSelected = () => {
    enhanceItems.mutate(Array.from(selection.selected), { onSuccess: selection.clear })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl min-w-0">
        <DialogHeader>
          <DialogTitle>Items eligible for enhancement</DialogTitle>
          <DialogDescription>
            Every item whose thumbnail is currently below the configured minimum dimension. Select items and enhance
            them together, or enhance the whole backlog from the AI Enhancement page.
          </DialogDescription>
        </DialogHeader>

        <DataTable
          className="gap-4"
          rows={items ?? []}
          getRowId={getItemId}
          columns={columns}
          selection="multi"
          selectionState={selection}
          getRowLabel={getItemLabel}
          pagination={pagination}
          loading={isLoading}
          loadingContent={loadingContent}
          empty={<p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing eligible right now.</p>}
          regionClassName="flex max-h-[60vh] flex-col overflow-hidden rounded-md border"
          containerClassName="min-h-0 flex-1 overflow-auto"
          toolbar={
            <Button size="sm" disabled={selection.size === 0 || enhanceItems.isPending} onClick={handleEnhanceSelected}>
              <Sparkles className="h-4 w-4" />
              Enhance Selected
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  )
}

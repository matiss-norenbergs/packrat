import { useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Link } from "react-router-dom"
import { useEnhanceThumbnailItems, useThumbnailEnhancementEligible } from "@/hooks/useThumbnailEnhancement"

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

export function EligibleItemsDialog({ open, onOpenChange }: EligibleItemsDialogProps) {
  const { data: items, isLoading } = useThumbnailEnhancementEligible(open)
  const enhanceItems = useEnhanceThumbnailItems()
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const toggleOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set((items ?? []).map((i) => i.libraryItemId)) : new Set())
  }

  const handleEnhanceSelected = () => {
    const ids = Array.from(selectedIds)
    enhanceItems.mutate(ids, { onSuccess: () => setSelectedIds(new Set()) })
  }

  const allSelected = !!items && items.length > 0 && selectedIds.size === items.length
  const someSelected = selectedIds.size > 0 && !allSelected

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

        <div className="flex items-center justify-between gap-3">
          <Button size="sm" disabled={selectedIds.size === 0 || enhanceItems.isPending} onClick={handleEnhanceSelected}>
            <Sparkles className="h-4 w-4" />
            Enhance Selected
          </Button>
          <span className="text-sm text-muted-foreground">
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Nothing selected"}
          </span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto rounded-md border">
          {isLoading ? (
            <div className="space-y-1 p-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : !items || items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing eligible right now.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-center">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={(checked) => toggleAll(checked === true)}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Artist</TableHead>
                  <TableHead>Collection</TableHead>
                  <TableHead className="text-right">Dimensions</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.libraryItemId}>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={selectedIds.has(item.libraryItemId)}
                        onCheckedChange={(checked) => toggleOne(item.libraryItemId, checked === true)}
                        aria-label={`Select ${item.itemTitle}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate">
                      <Link
                        to={`/library/${item.libraryItemId}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {item.itemTitle}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.artistName ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{item.collectionName ?? "—"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {item.width}×{item.height}
                    </TableCell>
                    <TableCell className="text-center">
                      {item.isProcessing ? (
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
                          <TooltipContent>
                            Failed {timeAgo(item.recentlyFailedAt)} — skipped from automatic runs, still retryable
                            here.
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

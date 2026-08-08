import { useState } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Link } from "react-router-dom"
import { useEnhanceThumbnailItem, useThumbnailEnhancementEligible } from "@/hooks/useThumbnailEnhancement"

// maxEnhancementsPerSweep mirrors the backend's fixed constant of the same
// name (backend/internal/thumbnailenhance/enhance.go) — not fetched from
// the API, just used here to explain why only some of a longer list would
// actually be touched by the next click.
const MAX_ENHANCEMENTS_PER_SWEEP = 5

interface EligibleItemsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EligibleItemsDialog({ open, onOpenChange }: EligibleItemsDialogProps) {
  const { data: items, isLoading } = useThumbnailEnhancementEligible(open)
  const enhanceItem = useEnhanceThumbnailItem()
  const [pendingId, setPendingId] = useState<number | null>(null)

  const handleEnhance = (libraryItemId: number) => {
    setPendingId(libraryItemId)
    enhanceItem.mutate(libraryItemId, { onSettled: () => setPendingId(null) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg min-w-0">
        <DialogHeader>
          <DialogTitle>Items eligible for enhancement</DialogTitle>
          <DialogDescription>
            Every item whose thumbnail is currently below the configured minimum dimension.
            {items && items.length > MAX_ENHANCEMENTS_PER_SWEEP && (
              <> Only the first {MAX_ENHANCEMENTS_PER_SWEEP} are processed per "Enhance Now" click or
              scheduled run — the rest wait for a later one.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)
          ) : !items || items.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">Nothing eligible right now.</p>
          ) : (
            items.map((item, i) => (
              <div key={item.libraryItemId} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <Link
                  to={`/library/${item.libraryItemId}`}
                  className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-2 hover:underline"
                >
                  {item.itemTitle}
                </Link>
                <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {item.width}×{item.height}
                  </span>
                  {i >= MAX_ENHANCEMENTS_PER_SWEEP && <span>Waiting</span>}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pendingId != null}
                    onClick={() => handleEnhance(item.libraryItemId)}
                  >
                    <Sparkles className="h-4 w-4" />
                    {pendingId === item.libraryItemId ? "Enhancing…" : "Enhance"}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

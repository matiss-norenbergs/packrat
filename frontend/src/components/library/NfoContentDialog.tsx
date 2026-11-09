import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useLibraryItemNFO } from "@/hooks/useLibrary"
import { ApiError } from "@/lib/api"
import type { LibraryItem } from "@/types/api"

interface NfoContentDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NfoContentDialog({ item, open, onOpenChange }: NfoContentDialogProps) {
  const { data, isLoading, isError, error } = useLibraryItemNFO(item.id, open)
  // 404 = the item has no .nfo on disk (common for items with Generate NFO off, whose menu entry stays
  // enabled because list responses don't check them): a plain statement, not an error.
  const noFile = error instanceof ApiError && error.status === 404

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>NFO Contents</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            {noFile ? "No NFO file for this item" : error instanceof Error ? error.message : "Could not load the NFO file."}
          </p>
        ) : (
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{data?.content}</pre>
        )}
      </DialogContent>
    </Dialog>
  )
}

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useLibraryItemNFO } from "@/hooks/useLibrary"
import type { LibraryItem } from "@/types/api"

interface NfoContentDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NfoContentDialog({ item, open, onOpenChange }: NfoContentDialogProps) {
  const { data, isLoading, isError, error } = useLibraryItemNFO(item.id, open)

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
            {error instanceof Error ? error.message : "No .nfo file has been generated for this item."}
          </p>
        ) : (
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{data?.content}</pre>
        )}
      </DialogContent>
    </Dialog>
  )
}

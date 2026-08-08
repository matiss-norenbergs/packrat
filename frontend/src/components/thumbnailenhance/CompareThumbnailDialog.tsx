import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useDeleteThumbnailOriginal, useRevertThumbnailOriginal } from "@/hooks/useThumbnailEnhancement"
import { imageUrl, mediaFileUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { ThumbnailEnhancementHistoryEntry } from "@/types/api"
import { ImageCompareSliderDialog } from "./ImageCompareSliderDialog"

interface CompareThumbnailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: ThumbnailEnhancementHistoryEntry
}

function dimensions(width: number | null, height: number | null): string {
  return width != null && height != null ? `${width}×${height}` : "—"
}

export function CompareThumbnailDialog({ open, onOpenChange, entry }: CompareThumbnailDialogProps) {
  const revertOriginal = useRevertThumbnailOriginal()
  const deleteOriginal = useDeleteThumbnailOriginal()
  const [confirmAction, setConfirmAction] = useState<"revert" | "delete" | null>(null)
  const [overlayOpen, setOverlayOpen] = useState(false)

  const libraryItemId = entry.libraryItemId
  // The fullscreen slider needs both images — only offer it once there's
  // actually something to compare against.
  const canOverlay = Boolean(entry.originalThumbnailPath && entry.enhancedThumbnailPath)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[95vw] max-h-[90vh] min-w-0 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Compare — {entry.itemTitle}</DialogTitle>
            <DialogDescription>
              The original thumbnail is preserved until you revert or delete it here.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Original</p>
              {entry.originalThumbnailPath && (
                <img
                  src={imageUrl(entry.originalThumbnailPath)}
                  alt="Original thumbnail"
                  onClick={canOverlay ? () => setOverlayOpen(true) : undefined}
                  title={canOverlay ? "Click to compare" : undefined}
                  className={cn(
                    "h-[60vh] w-full rounded-md border object-contain",
                    canOverlay && "cursor-zoom-in"
                  )}
                />
              )}
              <p className="text-xs text-muted-foreground">{dimensions(entry.originalWidth, entry.originalHeight)}</p>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Enhanced</p>
              {entry.enhancedThumbnailPath && (
                <img
                  src={mediaFileUrl(entry.enhancedThumbnailPath)}
                  alt="Enhanced thumbnail"
                  onClick={canOverlay ? () => setOverlayOpen(true) : undefined}
                  title={canOverlay ? "Click to compare" : undefined}
                  className={cn(
                    "h-[60vh] w-full rounded-md border object-contain",
                    canOverlay && "cursor-zoom-in"
                  )}
                />
              )}
              <p className="text-xs text-muted-foreground">{dimensions(entry.enhancedWidth, entry.enhancedHeight)}</p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="destructive" onClick={() => setConfirmAction("revert")}>
              Keep Original
            </Button>
            <Button variant="outline" onClick={() => setConfirmAction("delete")}>
              Keep Enhanced
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmAction != null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "revert" ? "Keep the original thumbnail?" : "Keep the enhanced thumbnail?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "revert"
                ? "Restores the pre-enhancement thumbnail and discards the enhanced version. This can't be undone."
                : "Keeps the enhanced thumbnail permanently and frees the stored original — you won't be able to compare or revert this item anymore."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (libraryItemId == null) return
                if (confirmAction === "revert") {
                  revertOriginal.mutate(libraryItemId, { onSuccess: () => onOpenChange(false) })
                } else if (confirmAction === "delete") {
                  deleteOriginal.mutate(libraryItemId, { onSuccess: () => onOpenChange(false) })
                }
                setConfirmAction(null)
              }}
            >
              {confirmAction === "revert" ? "Keep Original" : "Keep Enhanced"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canOverlay && (
        <ImageCompareSliderDialog
          open={overlayOpen}
          onOpenChange={setOverlayOpen}
          originalUrl={imageUrl(entry.originalThumbnailPath!)}
          enhancedUrl={mediaFileUrl(entry.enhancedThumbnailPath!)}
          itemTitle={entry.itemTitle}
        />
      )}
    </>
  )
}

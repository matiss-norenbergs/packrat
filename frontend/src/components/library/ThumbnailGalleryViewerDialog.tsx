import { useEffect, useState } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { CheckCircle2, ChevronLeftIcon, ChevronRightIcon, Trash2, XIcon } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { imageUrl } from "@/lib/api"
import type { ThumbnailGalleryImage } from "@/types/api"

interface ThumbnailGalleryViewerDialogProps {
  images: ThumbnailGalleryImage[]
  initialIndex: number
  open: boolean
  onOpenChange: (open: boolean) => void
  itemTitle: string
  onSetAsThumbnail: (galleryId: number) => void
  onDelete: (galleryId: number) => void
  isApplying: boolean
}

// ThumbnailGalleryViewerDialog is a fullscreen, backdrop-less carousel over
// a library item's saved gallery images — opened by clicking a tile in
// ThumbnailGalleryDialog's grid, same fullscreen convention as
// ImageCompareSliderDialog (raw DialogPrimitive, not the boxed shadcn
// Dialog, so the image gets the whole viewport instead of a card).
export function ThumbnailGalleryViewerDialog({
  images,
  initialIndex,
  open,
  onOpenChange,
  itemTitle,
  onSetAsThumbnail,
  onDelete,
  isApplying,
}: ThumbnailGalleryViewerDialogProps) {
  const [index, setIndex] = useState(initialIndex)

  // Jump to whichever tile was clicked every time the viewer (re)opens —
  // it may have been opened from a different tile than last time.
  useEffect(() => {
    if (open) setIndex(initialIndex)
  }, [open, initialIndex])

  // A delete from inside the viewer shrinks `images` out from under the
  // current index — clamp back into range, or close if nothing's left.
  useEffect(() => {
    if (!open) return
    if (images.length === 0) {
      onOpenChange(false)
      return
    }
    if (index > images.length - 1) setIndex(images.length - 1)
  }, [open, images.length, index, onOpenChange])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1))
      if (e.key === "ArrowRight") setIndex((i) => Math.min(images.length - 1, i + 1))
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [open, images.length])

  const current = images[index]
  if (!current) return null

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col bg-background outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Clicking inside the delete-confirm AlertDialog it triggers
          // (rendered by the parent ThumbnailGalleryDialog, portaled
          // outside this Content's DOM subtree) would otherwise read as
          // an outside click and close this viewer too.
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">Thumbnail gallery — {itemTitle}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Browse this item's saved gallery images. Use the arrow keys or the on-screen arrows to switch between
            them.
          </DialogPrimitive.Description>

          <Tooltip>
            <TooltipTrigger asChild>
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  className="absolute top-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                >
                  <XIcon className="h-5 w-5" />
                  <span className="sr-only">Close</span>
                </button>
              </DialogPrimitive.Close>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>

          {index > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Previous image"
                  onClick={() => setIndex((i) => i - 1)}
                  className="absolute left-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                >
                  <ChevronLeftIcon className="h-6 w-6" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Previous image</TooltipContent>
            </Tooltip>
          )}
          {index < images.length - 1 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Next image"
                  onClick={() => setIndex((i) => i + 1)}
                  className="absolute right-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                >
                  <ChevronRightIcon className="h-6 w-6" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Next image</TooltipContent>
            </Tooltip>
          )}

          <div className="flex flex-1 items-center justify-center overflow-hidden p-2">
            <img
              key={current.id}
              src={imageUrl(current.imagePath)}
              alt="Saved thumbnail"
              className="h-full w-full select-none object-contain"
            />
          </div>

          <div className="flex items-center justify-between gap-3 bg-black/60 px-4 py-3 backdrop-blur-sm">
            <span className="text-xs text-white/70">
              {images.length > 1 ? `${index + 1} / ${images.length}` : null}
              {current.width && current.height ? ` — ${current.width}×${current.height}` : null}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isApplying}
                onClick={() => onSetAsThumbnail(current.id)}
                className="flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Set as thumbnail
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Remove from gallery"
                    onClick={() => onDelete(current.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/70"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Remove from gallery</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

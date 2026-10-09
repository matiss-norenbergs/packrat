import { useMemo, useState } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { ArrowDownNarrowWide, ArrowUpNarrowWide, CheckCircle2, Heart, Trash2, XIcon } from "lucide-react"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ThumbnailDimensionsValue } from "@/components/ThumbnailDimensionsValue"
import {
  useApplyThumbnailFromGallery,
  useDeleteThumbnailGalleryImage,
  useSetThumbnailGalleryFavorite,
  useThumbnailGallery,
} from "@/hooks/useThumbnailGallery"
import { imageUrl } from "@/lib/api"
import { applyGalleryView, defaultSortDirection, type GalleryFilter, type GallerySort, type GallerySortDirection } from "@/lib/thumbnailGalleryView"
import { cn, formatDuration, formatPreciseTime } from "@/lib/utils"
import type { LibraryItem } from "@/types/api"
import { ThumbnailGalleryViewerDialog } from "./ThumbnailGalleryViewerDialog"

interface ThumbnailGalleryDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ThumbnailGalleryDialog({ item, open, onOpenChange }: ThumbnailGalleryDialogProps) {
  const { data, isLoading } = useThumbnailGallery(item.id, open)
  const applyThumbnail = useApplyThumbnailFromGallery()
  const deleteImage = useDeleteThumbnailGalleryImage()
  const setFavorite = useSetThumbnailGalleryFavorite()
  const [sort, setSort] = useState<GallerySort>("saved")
  const [direction, setDirection] = useState<GallerySortDirection>(defaultSortDirection.saved)
  const [filter, setFilter] = useState<GalleryFilter>("all")
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)

  const allImages = data?.images ?? []
  // The viewer indexes into the same displayed list as the grid, so its
  // next/prev follows whatever sort/filter is active.
  const images = useMemo(() => applyGalleryView(data?.images ?? [], sort, direction, filter), [data, sort, direction, filter])

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            className="fixed inset-0 z-50 flex flex-col bg-background outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
            // Without this, clicking inside the nested delete-confirm
            // AlertDialog (portaled outside this Content's DOM subtree)
            // reads as an outside click and closes this dialog too — same
            // nested-popup issue the shared DialogContent guards against
            // by default, which this raw fullscreen variant doesn't get
            // for free.
            onPointerDownOutside={(e) => e.preventDefault()}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b p-4">
              <div className="flex flex-col gap-1">
                <DialogPrimitive.Title className="text-lg font-semibold">
                  Thumbnail gallery — {item.title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-sm text-muted-foreground">
                  Images saved for this item — click one for a closer look, set it as the thumbnail, or remove it.
                </DialogPrimitive.Description>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Select value={filter} onValueChange={(v) => setFilter(v as GalleryFilter)}>
                  <SelectTrigger className="w-44" aria-label="Filter gallery">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All images</SelectItem>
                    <SelectItem value="favorites">Favorites only</SelectItem>
                    <SelectItem value="with-time">With frame time</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={sort}
                  onValueChange={(v) => {
                    setSort(v as GallerySort)
                    setDirection(defaultSortDirection[v as GallerySort])
                  }}
                >
                  <SelectTrigger className="w-44" aria-label="Sort gallery">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="saved">Date saved</SelectItem>
                    <SelectItem value="frame-time">Frame time</SelectItem>
                    <SelectItem value="favorites">Favorites</SelectItem>
                  </SelectContent>
                </Select>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={direction === "asc" ? "Ascending" : "Descending"}
                      onClick={() => setDirection((d) => (d === "asc" ? "desc" : "asc"))}
                    >
                      {direction === "asc" ? <ArrowUpNarrowWide /> : <ArrowDownNarrowWide />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{direction === "asc" ? "Ascending" : "Descending"} — click to reverse</TooltipContent>
                </Tooltip>
              </div>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon-sm">
                  <XIcon />
                  <span className="sr-only">Close</span>
                </Button>
              </DialogPrimitive.Close>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {isLoading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-video w-full" />
                  ))}
                </div>
              ) : allImages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No images saved yet — use "Save in Thumbnail Gallery" or the save icon on a frame in "Choose from Video…".
                </p>
              ) : images.length === 0 ? (
                <p className="text-sm text-muted-foreground">No images match this filter.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {images.map((img, i) => (
                    <div key={img.id} className="space-y-1.5">
                      <div className="group relative overflow-hidden rounded-md border">
                        <img
                          src={imageUrl(img.imagePath)}
                          alt="Saved thumbnail"
                          title="Click to view"
                          onClick={() => setViewerIndex(i)}
                          className="aspect-video w-full cursor-zoom-in object-cover"
                        />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label="Set as thumbnail"
                              disabled={applyThumbnail.isPending}
                              onClick={() => applyThumbnail.mutate({ id: item.id, galleryId: img.id })}
                              className="absolute left-1.5 top-1.5 rounded-full bg-black/70 p-1.5 text-white opacity-0 transition hover:bg-black/90 group-hover:opacity-100 disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Set as thumbnail</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={img.isFavorite ? "Remove from favorites" : "Add to favorites"}
                              onClick={() => setFavorite.mutate({ id: item.id, galleryId: img.id, isFavorite: !img.isFavorite })}
                              className={cn(
                                "absolute bottom-1.5 right-1.5 rounded-full bg-black/70 p-1.5 text-white transition hover:bg-black/90",
                                !img.isFavorite && "opacity-0 group-hover:opacity-100",
                              )}
                            >
                              <Heart className={cn("h-3.5 w-3.5", img.isFavorite && "fill-current")} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>{img.isFavorite ? "Remove from favorites" : "Add to favorites"}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label="Remove from gallery"
                              onClick={() => setConfirmDeleteId(img.id)}
                              className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1.5 text-white opacity-0 transition hover:bg-black/90 group-hover:opacity-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Remove from gallery</TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <ThumbnailDimensionsValue width={img.width} height={img.height} className="text-xs text-muted-foreground" />
                        {img.timestampSeconds != null && (
                          <span title={`Frame at ${formatPreciseTime(img.timestampSeconds)}`}>{formatDuration(img.timestampSeconds)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <ThumbnailGalleryViewerDialog
        images={images}
        initialIndex={viewerIndex ?? 0}
        open={viewerIndex != null}
        onOpenChange={(open) => !open && setViewerIndex(null)}
        itemTitle={item.title}
        isApplying={applyThumbnail.isPending}
        onSetAsThumbnail={(galleryId) => applyThumbnail.mutate({ id: item.id, galleryId })}
        onToggleFavorite={(galleryId, isFavorite) => setFavorite.mutate({ id: item.id, galleryId, isFavorite })}
        onDelete={(galleryId) => setConfirmDeleteId(galleryId)}
      />

      <AlertDialog open={confirmDeleteId != null} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this image from the gallery?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone. It won't affect the item's current thumbnail.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDeleteId != null) deleteImage.mutate({ id: item.id, galleryId: confirmDeleteId })
                setConfirmDeleteId(null)
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

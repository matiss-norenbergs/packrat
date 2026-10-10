import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { ArrowDownNarrowWide, ArrowUpNarrowWide, CheckCheck, CheckCircle2, Heart, HeartOff, Info, Square, Trash2, XIcon } from "lucide-react"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ThumbnailDimensionsValue } from "@/components/ThumbnailDimensionsValue"
import { useIdSelection } from "@/hooks/useIdSelection"
import {
  useApplyThumbnailFromGallery,
  useDeleteThumbnailGalleryImages,
  useSetThumbnailGalleryFavorite,
  useSetThumbnailGalleryFavorites,
  useThumbnailGallery,
} from "@/hooks/useThumbnailGallery"
import { imageUrl } from "@/lib/api"
import {
  applyGalleryView,
  defaultSortDirection,
  galleryIdRange,
  type GalleryFilter,
  type GallerySort,
  type GallerySortDirection,
} from "@/lib/thumbnailGalleryView"
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
  const deleteImages = useDeleteThumbnailGalleryImages()
  const setFavorite = useSetThumbnailGalleryFavorite()
  const setFavorites = useSetThumbnailGalleryFavorites()
  const [sort, setSort] = useState<GallerySort>("saved")
  const [direction, setDirection] = useState<GallerySortDirection>(defaultSortDirection.saved)
  const [filter, setFilter] = useState<GalleryFilter>("all")
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<number[] | null>(null)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  // Manage mode swaps the per-tile hover buttons for selection circles and
  // reveals the bulk toolbar buttons. Selection is session-only and is
  // cleared whenever manage mode is left.
  const [manageMode, setManageMode] = useState(false)
  const selection = useIdSelection()
  const anchorIdRef = useRef<number | null>(null)

  // LibraryItemActionsMenu keeps this component mounted while closed (only
  // the Radix content unmounts), so manage mode and the selection would
  // otherwise survive a close/reopen. Reset them on open rather than on
  // close so nothing visibly changes during the fade-out.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setManageMode(false)
      selection.clear()
      setViewerIndex(null)
      setConfirmDeleteIds(null)
    }
  }

  const allImages = data?.images ?? []
  // The viewer indexes into the same displayed list as the grid, so its
  // next/prev follows whatever sort/filter is active.
  const images = useMemo(() => applyGalleryView(data?.images ?? [], sort, direction, filter), [data, sort, direction, filter])

  // Bulk actions only ever touch what's currently displayed — an image the
  // filter hid (or that was just deleted) is not part of the selection.
  const selectedImages = images.filter((img) => selection.isSelected(img.id))
  const allSelected = images.length > 0 && selectedImages.length === images.length
  const toFavorite = selectedImages.filter((img) => !img.isFavorite).map((img) => img.id)
  const toUnfavorite = selectedImages.filter((img) => img.isFavorite).map((img) => img.id)
  const bulkBusy = setFavorites.isPending || deleteImages.isPending

  const hint = manageMode
    ? "Manage mode — click images to select them, shift-click to select a range."
    : "Images saved for this item — click one for a closer look, set it as the thumbnail, or remove it."

  const changeManageMode = (on: boolean) => {
    setManageMode(on)
    selection.clear()
    anchorIdRef.current = null
  }

  const handleTileSelect = (e: { shiftKey: boolean }, id: number) => {
    if (e.shiftKey && anchorIdRef.current != null) {
      selection.selectAll([...selection.selected, ...galleryIdRange(images, anchorIdRef.current, id)])
    } else {
      selection.toggle(id)
    }
    anchorIdRef.current = id
  }

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
            // Esc leaves manage mode first (dropping the selection) and only
            // closes the dialog from the normal view.
            onEscapeKeyDown={(e) => {
              if (manageMode) {
                e.preventDefault()
                changeManageMode(false)
              }
            }}
          >
            <div className="flex shrink-0 items-center justify-between gap-4 border-b px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <DialogPrimitive.Title className="truncate text-lg font-semibold">
                  Thumbnail gallery — {item.title}
                </DialogPrimitive.Title>
                {/* The hint lives in a tooltip to keep the header one line
                    tall; the sr-only Description keeps it available to
                    screen readers (Radix expects one). */}
                <DialogPrimitive.Description className="sr-only">{hint}</DialogPrimitive.Description>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="About this gallery"
                      className="shrink-0 rounded-full text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{hint}</TooltipContent>
                </Tooltip>
              </div>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon-sm">
                  <XIcon />
                  <span className="sr-only">Close</span>
                </Button>
              </DialogPrimitive.Close>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
              <label className="flex cursor-pointer items-center gap-2 pr-2 text-sm font-medium">
                <Switch checked={manageMode} onCheckedChange={changeManageMode} />
                Manage
              </label>
              {manageMode && (
                <>
                  <Button
                    variant="outline"
                    disabled={images.length === 0}
                    onClick={() => {
                      if (allSelected) selection.clear()
                      else selection.selectAll(images.map((img) => img.id))
                    }}
                  >
                    {allSelected ? <Square /> : <CheckCheck />}
                    {allSelected ? "Deselect all" : "Select all"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={toFavorite.length === 0 || bulkBusy}
                    onClick={() => setFavorites.mutate({ id: item.id, galleryIds: toFavorite, isFavorite: true })}
                  >
                    <Heart />
                    Favorite
                  </Button>
                  <Button
                    variant="outline"
                    disabled={toUnfavorite.length === 0 || bulkBusy}
                    onClick={() => setFavorites.mutate({ id: item.id, galleryIds: toUnfavorite, isFavorite: false })}
                  >
                    <HeartOff />
                    Unfavorite
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={selectedImages.length === 0 || bulkBusy}
                    onClick={() => setConfirmDeleteIds(selectedImages.map((img) => img.id))}
                  >
                    <Trash2 />
                    Delete
                  </Button>
                  <span className="text-sm text-muted-foreground">{selectedImages.length} selected</span>
                </>
              )}
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
                  {images.map((img, i) => {
                    const selected = selection.isSelected(img.id)
                    return (
                      <div key={img.id} className="space-y-1.5">
                        <div
                          className={cn(
                            "group relative overflow-hidden rounded-md border",
                            manageMode && "cursor-pointer select-none",
                            manageMode && selected && "ring-2 ring-primary",
                          )}
                          // In manage mode the whole tile is the selection
                          // target (so shift-click ranges work from anywhere
                          // on it) and nothing opens the viewer.
                          {...(manageMode && {
                            role: "checkbox",
                            "aria-checked": selected,
                            tabIndex: 0,
                            onClick: (e: MouseEvent) => handleTileSelect(e, img.id),
                            onKeyDown: (e: KeyboardEvent) => {
                              if (e.key === " " || e.key === "Enter") {
                                e.preventDefault()
                                handleTileSelect(e, img.id)
                              }
                            },
                          })}
                        >
                          <img
                            src={imageUrl(img.imagePath)}
                            alt="Saved thumbnail"
                            title={manageMode ? undefined : "Click to view"}
                            onClick={manageMode ? undefined : () => setViewerIndex(i)}
                            draggable={!manageMode}
                            className={cn("aspect-video w-full object-cover", !manageMode && "cursor-zoom-in")}
                          />
                          {manageMode ? (
                            <>
                              <Checkbox
                                checked={selected}
                                tabIndex={-1}
                                aria-hidden
                                // Same duotone ring as LibraryCard's checkbox so
                                // it reads on any frame. Display-only: the tile
                                // handles the click.
                                className="pointer-events-none absolute top-2 left-2 z-10 size-5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
                              />
                              {img.isFavorite && (
                                <Heart className="absolute bottom-1.5 right-1.5 h-4 w-4 fill-current text-white drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]" />
                              )}
                            </>
                          ) : (
                            <>
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
                                    onClick={() => setConfirmDeleteIds([img.id])}
                                    className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1.5 text-white opacity-0 transition hover:bg-black/90 group-hover:opacity-100"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Remove from gallery</TooltipContent>
                              </Tooltip>
                            </>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <ThumbnailDimensionsValue width={img.width} height={img.height} className="text-xs text-muted-foreground" />
                          {img.timestampSeconds != null && (
                            <span title={`Frame at ${formatPreciseTime(img.timestampSeconds)}`}>{formatDuration(img.timestampSeconds)}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
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
        onDelete={(galleryId) => setConfirmDeleteIds([galleryId])}
      />

      <AlertDialog open={confirmDeleteIds != null} onOpenChange={(open) => !open && setConfirmDeleteIds(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDeleteIds && confirmDeleteIds.length > 1
                ? `Remove ${confirmDeleteIds.length} images from the gallery?`
                : "Remove this image from the gallery?"}
            </AlertDialogTitle>
            <AlertDialogDescription>This can't be undone. It won't affect the item's current thumbnail.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDeleteIds != null) {
                  deleteImages.mutate({ id: item.id, galleryIds: confirmDeleteIds })
                  selection.clear()
                }
                setConfirmDeleteIds(null)
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

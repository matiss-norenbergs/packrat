import { memo, useState, type ImgHTMLAttributes, type KeyboardEvent, type MouseEvent } from "react"
import { CheckCircle2, Heart, Trash2 } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ThumbnailDimensionsValue } from "@/components/ThumbnailDimensionsValue"
import { type ResizeWidth, imageUrl, resizedImageSrcSet } from "@/lib/api"
import { cn, formatDuration, formatPreciseTime } from "@/lib/utils"
import { touchRevealedHitArea } from "@/lib/touchTarget"
import type { ThumbnailGalleryImage } from "@/types/api"

interface ThumbnailGalleryTileProps {
  image: ThumbnailGalleryImage
  /** The tile's position in the displayed (sorted + filtered) list; the viewer opens at it. */
  index: number
  manageMode: boolean
  selected: boolean
  /** Disables "Set as thumbnail" while an apply is in flight. */
  applyDisabled: boolean
  // All callbacks must be stable (the dialog passes refs-backed ones), or memo() does nothing and every tile
  // re-renders on each selection change.
  onSelect: (e: { shiftKey: boolean }, id: number) => void
  onOpen: (index: number) => void
  onApply: (id: number) => void
  onToggleFavorite: (id: number, isFavorite: boolean) => void
  onRemove: (id: number) => void
}

// One gallery tile: the image with its hover buttons (or, in manage mode, the selection circle) and the caption row.
// Memoized: with the grid's cells rebuilt on every selection change, only tiles whose own props changed re-render.
export const ThumbnailGalleryTile = memo(function ThumbnailGalleryTile({
  image: img,
  index,
  manageMode,
  selected,
  applyDisabled,
  onSelect,
  onOpen,
  onApply,
  onToggleFavorite,
  onRemove,
}: ThumbnailGalleryTileProps) {
  return (
    <div className="space-y-1.5">
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
          onClick: (e: MouseEvent) => onSelect(e, img.id),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault()
              onSelect(e, img.id)
            }
          },
        })}
      >
        <GalleryTileImage
          path={img.imagePath}
          alt="Saved thumbnail"
          // Off-screen tiles aren't fetched until scrolled
          // near; aspect-video reserves each tile's space
          // so the grid doesn't shift as images arrive.
          loading="lazy"
          decoding="async"
          title={manageMode ? undefined : "Click to view"}
          onClick={manageMode ? undefined : () => onOpen(index)}
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
                  disabled={applyDisabled}
                  onClick={() => onApply(img.id)}
                  className={cn("absolute left-1.5 top-1.5 rounded-full bg-black/70 p-1.5 text-white opacity-0 transition hover:bg-black/90 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50", touchRevealedHitArea(26))}
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
                  onClick={() => onToggleFavorite(img.id, !img.isFavorite)}
                  className={cn(
                    "absolute bottom-1.5 right-1.5 rounded-full bg-black/70 p-1.5 text-white transition hover:bg-black/90",
                    !img.isFavorite && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                    touchRevealedHitArea(26),
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
                  onClick={() => onRemove(img.id)}
                  className={cn("absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1.5 text-white opacity-0 transition hover:bg-black/90 group-hover:opacity-100 focus-visible:opacity-100", touchRevealedHitArea(26))}
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
})

// Candidate widths for a grid tile's srcset (the whitelisted widths that
// cover a tile at 1x and 2x pixel density).
const TILE_WIDTHS: readonly ResizeWidth[] = [320, 480, 720]

// A tile's rendered width at each `gallery` breakpoint (2 / 4 / 6 columns below sm (640px) / below lg (1024px) / from
// lg up, 12px gaps). The dialog's content is the viewport minus 16px of padding on each side, and ResponsiveGrid's
// region reserves a stable scrollbar gutter, so a tile is
// (100vw - 32px - gutter - (cols-1)*12px) / cols wide. The gutter is taken as a 15px classic scrollbar (overlay
// scrollbars make a tile up to 15px/cols wider than this, which only ever asks for a slightly smaller candidate).
// 6 cols: 100vw - 32 - 15 - 60 = 100vw - 107; 4 cols: - 36 = 100vw - 83; 2 cols: - 12 = 100vw - 59.
const TILE_SIZES =
  "(min-width: 1024px) calc((100vw - 107px) / 6), (min-width: 640px) calc((100vw - 83px) / 4), calc((100vw - 59px) / 2)"

// A grid tile served as a resized WebP via srcset, with the original file as
// the `src` fallback. If the resized request errors the srcset is dropped so
// the browser loads the original and a tile never goes blank. The full-size
// viewer deliberately keeps using the original file.
function GalleryTileImage({ path, ...props }: { path: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "sizes">) {
  const [resizeFailed, setResizeFailed] = useState(false)
  return (
    <img
      {...props}
      src={imageUrl(path)}
      srcSet={resizeFailed ? undefined : resizedImageSrcSet({ root: "images", path, widths: TILE_WIDTHS })}
      sizes={resizeFailed ? undefined : TILE_SIZES}
      onError={() => setResizeFailed(true)}
    />
  )
}

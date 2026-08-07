import { Ghost, X } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { MediaTypePlaceholder } from "@/components/MediaTypePlaceholder"
import { libraryMediumThumbnailUrl } from "@/lib/api"
import { cn, formatDuration, hashText } from "@/lib/utils"
import { useRevealAll } from "./RevealAllContext"
import type { LibraryItem } from "@/types/api"

interface CompareListTileProps {
  item: LibraryItem
  selected: boolean
  // False once 6 are already selected and this tile isn't one of them —
  // disables (not hides) the checkbox/tap-to-select rather than removing the
  // affordance entirely, so it's clear why it's unavailable.
  canSelect: boolean
  onToggle: () => void
  onRemove: () => void
}

// Deliberately not LibraryCard — that component's checkbox only appears on
// hover until something is already selected, which has no first-tap
// affordance on touch devices (there's no hover to reveal it). This tile's
// checkbox is always visible and the whole card is tap-to-toggle from the
// very first item, so mobile selection works with no pre-requisite step.
export function CompareListTile({ item, selected, canSelect, onToggle, onRemove }: CompareListTileProps) {
  const { isRevealed, toggleItem: toggleReveal } = useRevealAll()
  const revealed = isRevealed(item.id)
  const thumbUrl = libraryMediumThumbnailUrl(item)
  const isGhost = item.status === "ghost"
  // A ghost item has no file to play — it can still sit in the list (added
  // before its file was deleted) but can never be selected into a play
  // session, regardless of the 6-item cap.
  const disabled = isGhost || (!selected && !canSelect)

  return (
    <Card
      className={cn("gap-0 overflow-hidden py-0", !disabled && "cursor-pointer")}
      onClick={disabled ? undefined : onToggle}
    >
      <div className="relative aspect-video w-full bg-muted">
        {thumbUrl ? (
          <BlurredThumbnail
            src={thumbUrl}
            className="absolute inset-0 h-full w-full object-cover"
            blurred={item.blurred}
            revealed={revealed}
            onToggleReveal={() => {}}
            interactive={false}
          />
        ) : (
          <MediaTypePlaceholder mediaType={item.mediaType} />
        )}
        {isGhost && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-background/80 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            Ghost item
            <Ghost className="h-3 w-3" />
          </div>
        )}
        <Checkbox
          checked={selected}
          disabled={disabled}
          onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 left-2 z-10 size-5 rounded-full"
          aria-label="Select for playback"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute top-2 right-2 z-10 rounded-full bg-background/80 backdrop-blur-sm hover:bg-background"
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove from compare list</TooltipContent>
        </Tooltip>
      </div>
      <div className="space-y-1 p-3">
        <p
          className="line-clamp-2 cursor-pointer text-sm font-medium"
          onClick={(e) => {
            if (!item.blurred) return
            e.stopPropagation()
            toggleReveal(item.id)
          }}
        >
          {item.sequenceNumber != null && `${item.sequenceNumber}. `}
          {item.blurred && !revealed ? hashText(item.title) : item.title}
        </p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="truncate">{item.artistName ?? item.uploader ?? "Uncategorized"}</span>
          {item.duration != null && <span>{formatDuration(item.duration)}</span>}
        </div>
      </div>
    </Card>
  )
}

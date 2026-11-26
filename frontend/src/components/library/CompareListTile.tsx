import { Ghost, X } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { MediaTypePlaceholder } from "@/components/MediaTypePlaceholder"
import { useArtistNameMask } from "@/hooks/useArtistNameMask"
import { libraryMediumThumbnailUrl } from "@/lib/api"
import { REVEAL_TEXT_FOCUS_CLASS, revealToggleProps } from "@/lib/revealToggle"
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
  const maskArtist = useArtistNameMask()
  const thumbUrl = libraryMediumThumbnailUrl(item)
  const isGhost = item.status === "ghost"
  // A ghost item has no file to play — it can still sit in the list (added
  // before its file was deleted) but can never be selected into a play
  // session, regardless of the 6-item cap.
  // The visible title, masked the same way: a private item's real title never reaches a label.
  const shownTitle = item.blurred && !revealed ? hashText(item.title) : item.title
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
          className="absolute top-2 left-2 z-10 size-5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
          aria-label={`Select ${shownTitle} for playback`}
        />
        <TooltipIconButton
          label={`Remove ${shownTitle} from compare list`}
          tooltip="Remove from compare list"
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
        </TooltipIconButton>
      </div>
      <div className="space-y-1 p-3">
        <p
          className={cn("line-clamp-2 cursor-pointer text-sm font-medium", item.blurred && REVEAL_TEXT_FOCUS_CLASS)}
          {...(item.blurred ? revealToggleProps(revealed, () => toggleReveal(item.id), "title") : undefined)}
          onClick={(e) => {
            if (!item.blurred) return
            e.stopPropagation()
            toggleReveal(item.id)
          }}
        >
          {item.sequenceNumber != null && `${item.sequenceNumber}. `}
          {shownTitle}
        </p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {/* Same masking as LibraryCard: a blurred, unrevealed item's artist shows hashed; the uploader is not an artist. */}
          <span className="truncate">{item.artistName ? maskArtist(item.artistId, item.artistName, revealed || !item.blurred) : (item.uploader ?? "Uncategorized")}</span>
          {item.duration != null && <span>{formatDuration(item.duration)}</span>}
        </div>
      </div>
    </Card>
  )
}

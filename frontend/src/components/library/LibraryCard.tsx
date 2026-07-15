import { useLocation, useNavigate } from "react-router-dom"
import { Play } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { mediaFileUrl } from "@/lib/api"
import { useSettings } from "@/hooks/useSettings"
import { cn, formatBytes, formatDuration, hashText } from "@/lib/utils"
import { LibraryItemActionsMenu } from "./LibraryItemActionsMenu"
import { useRevealAll } from "./RevealAllContext"
import { useSelection } from "./SelectionContext"
import type { LibraryItem } from "@/types/api"

// Caps how many tag badges a card shows before collapsing the rest into a
// "+N" badge — keeps every card the same height regardless of tag count,
// and avoids the row wrapping onto a second line.
const MAX_VISIBLE_TAGS = 2

export function LibraryCard({ item }: { item: LibraryItem }) {
  const { isRevealed, toggleItem: toggleReveal } = useRevealAll()
  const { data: settings } = useSettings()
  const navigate = useNavigate()
  const location = useLocation()
  const revealed = isRevealed(item.id)
  const toggleRevealItem = () => toggleReveal(item.id)
  const mode = (settings?.libraryMode as "manage" | "details") || "manage"
  const visibleTags = item.tags.slice(0, MAX_VISIBLE_TAGS)
  const hiddenTags = item.tags.slice(MAX_VISIBLE_TAGS)

  const { selectionActive, isItemSelected, toggleItem: toggleSelected } = useSelection()
  const selected = isItemSelected(item.id)

  return (
    <Card
      className={cn("gap-0 overflow-hidden py-0", selectionActive && "cursor-pointer")}
      onClick={selectionActive ? () => toggleSelected(item) : undefined}
    >
      <div className="group relative aspect-video w-full bg-muted">
        {item.thumbnail ? (
          <BlurredThumbnail
            src={mediaFileUrl(item.thumbnail)}
            className="absolute inset-0 h-full w-full object-cover"
            blurred={item.blurred}
            revealed={revealed}
            onToggleReveal={selectionActive ? () => {} : toggleRevealItem}
            interactive={!selectionActive}
          />
        ) : null}
        {mode === "manage" && (
          <Checkbox
            checked={selected}
            onCheckedChange={() => toggleSelected(item)}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "absolute top-2 left-2 z-10 size-5 rounded-full transition-opacity",
              selectionActive || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            aria-label="Select"
          />
        )}
        {!selectionActive && (
          <div className="absolute top-1 right-1 rounded-md bg-background/80 backdrop-blur-sm">
            <LibraryItemActionsMenu item={item} />
          </div>
        )}
        {!selectionActive && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Button
              variant="ghost"
              size="icon"
              className="pointer-events-none h-12 w-12 rounded-full bg-background/80 opacity-0 backdrop-blur-sm transition-opacity hover:bg-background/90 group-hover:pointer-events-auto group-hover:opacity-100"
              title="Play"
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/library/${item.id}`, { state: { from: `${location.pathname}${location.search}` } })
              }}
            >
              <Play className="h-6 w-6" />
            </Button>
          </div>
        )}
      </div>
      <CardContent className="space-y-2 p-3">
        <p
          className={cn("line-clamp-2 text-sm font-medium", item.blurred && !selectionActive && "cursor-pointer")}
          onClick={!selectionActive && item.blurred ? toggleRevealItem : undefined}
          title={!selectionActive && item.blurred ? (revealed ? "Click to hide" : "Click to reveal") : undefined}
        >
          {item.sequenceNumber != null && `${item.sequenceNumber}. `}
          {item.blurred && !revealed ? hashText(item.title) : item.title}
        </p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="truncate">{item.artistName ?? item.uploader ?? "Uncategorized"}</span>
          {item.duration != null && <span>{formatDuration(item.duration)}</span>}
        </div>
        {item.tags.length > 0 && (
          <div className="flex flex-nowrap items-center gap-1 overflow-hidden">
            {visibleTags.map((tag) => (
              <Badge key={tag} variant="secondary" className="min-w-0 shrink truncate">
                {tag}
              </Badge>
            ))}
            {hiddenTags.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="shrink-0 cursor-default">
                    +{hiddenTags.length}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{hiddenTags.join(", ")}</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {mode === "details" && (
          <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
            <div className="flex justify-between gap-2">
              <span>Collection</span>
              <span className="truncate text-foreground">{item.collectionName ?? "Uncategorized"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Resolution</span>
              <span className="truncate text-foreground">{item.resolution ?? "-"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Artist</span>
              <span className="truncate text-foreground">{item.artistName ?? "-"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Year</span>
              <span className="text-foreground">{item.year ?? "-"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Season/Episode</span>
              <span className="text-foreground">
                {item.seasonNumber == null && item.sequenceNumber == null
                  ? "-"
                  : `${item.seasonNumber != null ? `S${String(item.seasonNumber).padStart(2, "0")}` : ""}${item.sequenceNumber != null ? `E${String(item.sequenceNumber).padStart(2, "0")}` : ""}`}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span>File size</span>
              <span className="text-foreground">{item.fileSizeBytes != null ? formatBytes(item.fileSizeBytes) : "-"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>{item.downloadId == null ? "Imported" : "Downloaded"}</span>
              <span className="text-foreground">{new Date(item.downloadedAt).toLocaleDateString()}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

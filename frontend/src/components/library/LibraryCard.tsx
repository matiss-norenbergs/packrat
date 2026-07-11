import { useState } from "react"
import { Play } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { mediaFileUrl } from "@/lib/api"
import { useSettings } from "@/hooks/useSettings"
import { cn, formatBytes, formatDuration, hashText } from "@/lib/utils"
import { LibraryItemActionsMenu } from "./LibraryItemActionsMenu"
import { MediaPlayerDialog } from "./MediaPlayerDialog"
import { useRevealAll } from "./RevealAllContext"
import type { LibraryItem } from "@/types/api"

export function LibraryCard({ item }: { item: LibraryItem }) {
  const { isRevealed, toggleItem } = useRevealAll()
  const { data: settings } = useSettings()
  const [playerOpen, setPlayerOpen] = useState(false)
  const revealed = isRevealed(item.id)
  const toggleReveal = () => toggleItem(item.id)
  const mode = (settings?.libraryMode as "manage" | "view" | "details") || "manage"
  const locked = item.blurred && !revealed

  return (
    <Card className="overflow-hidden py-0">
      <div className="relative aspect-video w-full bg-muted">
        {item.thumbnail ? (
          <BlurredThumbnail
            src={mediaFileUrl(item.thumbnail)}
            className="absolute inset-0 h-full w-full object-cover"
            blurred={item.blurred}
            revealed={revealed}
            onToggleReveal={toggleReveal}
          />
        ) : null}
        <div className="absolute top-1 right-1 rounded-md bg-background/80 backdrop-blur-sm">
          <LibraryItemActionsMenu item={item} />
        </div>
        {mode === "view" && (
          <div className="absolute bottom-1 right-1 rounded-md bg-background/80 backdrop-blur-sm">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={locked}
              title={locked ? "Reveal to play" : "Play"}
              onClick={(e) => {
                e.stopPropagation()
                setPlayerOpen(true)
              }}
            >
              <Play className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <CardContent className="space-y-2 p-3">
        <p
          className={cn("line-clamp-2 text-sm font-medium", item.blurred && "cursor-pointer")}
          onClick={item.blurred ? toggleReveal : undefined}
          title={item.blurred ? (revealed ? "Click to hide" : "Click to reveal") : undefined}
        >
          {item.sequenceNumber != null && `${item.sequenceNumber}. `}
          {item.blurred && !revealed ? hashText(item.title) : item.title}
        </p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="truncate">{item.uploader ?? "Uncategorized"}</span>
          {item.duration != null && <span>{formatDuration(item.duration)}</span>}
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">{item.collectionName ?? "Uncategorized"}</Badge>
          {item.downloadId == null && <Badge variant="secondary">Imported</Badge>}
          {item.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>

        {mode === "details" && (
          <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
            {item.resolution && (
              <div className="flex justify-between gap-2">
                <span>Resolution</span>
                <span className="truncate text-foreground">{item.resolution}</span>
              </div>
            )}
            {item.artist && (
              <div className="flex justify-between gap-2">
                <span>Artist</span>
                <span className="truncate text-foreground">{item.artist}</span>
              </div>
            )}
            {item.year != null && (
              <div className="flex justify-between gap-2">
                <span>Year</span>
                <span className="text-foreground">{item.year}</span>
              </div>
            )}
            {(item.seasonNumber != null || item.sequenceNumber != null) && (
              <div className="flex justify-between gap-2">
                <span>Season/Episode</span>
                <span className="text-foreground">
                  {item.seasonNumber != null && `S${String(item.seasonNumber).padStart(2, "0")}`}
                  {item.sequenceNumber != null && `E${String(item.sequenceNumber).padStart(2, "0")}`}
                </span>
              </div>
            )}
            {item.fileSizeBytes != null && (
              <div className="flex justify-between gap-2">
                <span>File size</span>
                <span className="text-foreground">{formatBytes(item.fileSizeBytes)}</span>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <span>Downloaded</span>
              <span className="text-foreground">{new Date(item.downloadedAt).toLocaleDateString()}</span>
            </div>
            {!locked && item.description && (
              <p className="line-clamp-2 pt-1 text-foreground">{item.description}</p>
            )}
            {!locked && item.originalUrl && (
              <a
                href={item.originalUrl}
                target="_blank"
                rel="noreferrer"
                className="block truncate pt-1 text-foreground underline underline-offset-2"
                onClick={(e) => e.stopPropagation()}
              >
                {item.originalUrl}
              </a>
            )}
          </div>
        )}
      </CardContent>

      <MediaPlayerDialog item={item} open={playerOpen} onOpenChange={setPlayerOpen} />
    </Card>
  )
}

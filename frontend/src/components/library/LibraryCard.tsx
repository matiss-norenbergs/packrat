import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { mediaFileUrl } from "@/lib/api"
import { cn, formatDuration, hashText } from "@/lib/utils"
import { LibraryItemActionsMenu } from "./LibraryItemActionsMenu"
import type { LibraryItem } from "@/types/api"

export function LibraryCard({ item }: { item: LibraryItem }) {
  const [revealed, setRevealed] = useState(false)
  const toggleReveal = () => setRevealed((v) => !v)

  return (
    <Card className="overflow-hidden py-0">
      <div className="relative aspect-video w-full bg-muted">
        {item.thumbnail ? (
          <BlurredThumbnail
            src={mediaFileUrl(item.thumbnail)}
            className="h-full w-full object-cover"
            blurred={item.blurred}
            revealed={revealed}
            onToggleReveal={toggleReveal}
          />
        ) : null}
        <div className="absolute top-1 right-1 rounded-md bg-background/80 backdrop-blur-sm">
          <LibraryItemActionsMenu item={item} />
        </div>
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
      </CardContent>
    </Card>
  )
}

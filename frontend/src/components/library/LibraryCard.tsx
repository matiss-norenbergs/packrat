import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { mediaFileUrl } from "@/lib/api"
import { formatDuration } from "@/lib/utils"
import { LibraryItemActionsMenu } from "./LibraryItemActionsMenu"
import type { LibraryItem } from "@/types/api"

export function LibraryCard({ item }: { item: LibraryItem }) {
  return (
    <Card className="overflow-hidden py-0">
      <div className="relative aspect-video w-full bg-muted">
        {item.thumbnail ? (
          <BlurredThumbnail
            src={mediaFileUrl(item.thumbnail)}
            className="h-full w-full object-cover"
            blurred={item.blurred}
          />
        ) : null}
        <div className="absolute top-1 right-1 rounded-md bg-background/80 backdrop-blur-sm">
          <LibraryItemActionsMenu item={item} />
        </div>
      </div>
      <CardContent className="space-y-2 p-3">
        <p className="line-clamp-2 text-sm font-medium">{item.title}</p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="truncate">{item.uploader ?? "Uncategorized"}</span>
          {item.duration != null && <span>{formatDuration(item.duration)}</span>}
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">{item.collectionName ?? "Uncategorized"}</Badge>
          {item.downloadId == null && <Badge variant="secondary">Imported</Badge>}
        </div>
      </CardContent>
    </Card>
  )
}

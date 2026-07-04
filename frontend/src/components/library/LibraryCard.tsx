import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { mediaFileUrl } from "@/lib/api"
import { formatDuration } from "@/lib/utils"
import type { LibraryItem } from "@/types/api"

export function LibraryCard({ item }: { item: LibraryItem }) {
  return (
    <Card className="overflow-hidden py-0">
      <div className="aspect-video w-full bg-muted">
        {item.thumbnail ? (
          <img
            src={mediaFileUrl(item.thumbnail)}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>
      <CardContent className="space-y-2 p-3">
        <p className="line-clamp-2 text-sm font-medium">{item.title}</p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="truncate">{item.uploader ?? "Uncategorized"}</span>
          {item.duration != null && <span>{formatDuration(item.duration)}</span>}
        </div>
        <Badge variant="outline">{item.collectionName ?? "Uncategorized"}</Badge>
      </CardContent>
    </Card>
  )
}

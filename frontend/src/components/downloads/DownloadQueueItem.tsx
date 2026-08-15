import { useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useCancelDownload } from "@/hooks/useDownloads"
import { formatDownloadStatus, formatEta, formatSpeed, hashText } from "@/lib/utils"
import type { Download } from "@/types/api"

export const CANCELLABLE_STATUSES = new Set(["queued", "fetching_metadata", "downloading", "processing"])

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline",
  fetching_metadata: "secondary",
  downloading: "secondary",
  processing: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
  interrupted: "destructive",
}

export function DownloadQueueItem({
  download,
  selected,
  onSelectedChange,
  onMouseDown,
  onMouseEnter,
}: {
  download: Download
  selected: boolean
  onSelectedChange: () => void
  onMouseDown: (e: React.MouseEvent) => void
  onMouseEnter: () => void
}) {
  const cancelDownload = useCancelDownload()
  const [revealed, setRevealed] = useState(false)
  const toggleReveal = () => setRevealed((v) => !v)
  const cancellable = CANCELLABLE_STATUSES.has(download.status)
  const displayName = download.title ?? download.url

  return (
    <div
      data-download-id={download.id}
      data-state={selected ? "selected" : undefined}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      className="flex cursor-default select-none items-center gap-4 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
    >
      <Checkbox checked={selected} onCheckedChange={onSelectedChange} aria-label={`Select ${displayName}`} />

      <div className="h-14 w-24 flex-shrink-0 overflow-hidden rounded bg-muted">
        {download.thumbnail ? (
          <BlurredThumbnail
            src={download.thumbnail}
            className="h-full w-full object-cover"
            blurred={download.blurred}
            revealed={revealed}
            onToggleReveal={toggleReveal}
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          {download.blurred ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="cursor-pointer truncate text-sm font-medium" onClick={toggleReveal}>
                  {!revealed ? hashText(displayName) : displayName}
                </p>
              </TooltipTrigger>
              <TooltipContent>{revealed ? "Click to hide" : "Click to reveal"}</TooltipContent>
            </Tooltip>
          ) : (
            <p className="truncate text-sm font-medium">{displayName}</p>
          )}
          <Badge variant={STATUS_VARIANT[download.status] ?? "outline"}>{formatDownloadStatus(download.status)}</Badge>
        </div>

        {download.status === "downloading" || download.status === "processing" ? (
          <>
            <Progress value={download.percent} className="h-1.5" />
            <p className="text-xs text-muted-foreground">
              {download.percent.toFixed(1)}% · {formatSpeed(download.speedBytesPerSec)} · ETA{" "}
              {formatEta(download.etaSeconds)}
            </p>
          </>
        ) : download.status === "failed" || download.status === "interrupted" ? (
          <p className="truncate text-xs text-destructive">{download.errorMessage}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{formatDownloadStatus(download.status)}</p>
        )}
      </div>

      {cancellable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => cancelDownload.mutate(download.id)}
              disabled={cancelDownload.isPending}
            >
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Cancel</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

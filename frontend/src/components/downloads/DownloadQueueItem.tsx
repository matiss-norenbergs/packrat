import { X } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button"
import { useRevealAll } from "@/components/library/RevealAllContext"
import { useCancelDownload } from "@/hooks/useDownloads"
import { downloadRevealKey } from "@/lib/revealKeys"
import { REVEAL_TEXT_FOCUS_CLASS, revealToggleProps } from "@/lib/revealToggle"
import { cn, formatDownloadStatus, formatEta, formatSpeed, hashText } from "@/lib/utils"
import type { Download } from "@/types/api"
import { remoteThumbnailSrc } from "@/lib/api"

export const CANCELLABLE_STATUSES = new Set(["queued", "fetching_metadata", "downloading", "processing"])

const STATUS_VARIANT: Record<string, "success" | "secondary" | "destructive" | "outline"> = {
  queued: "outline",
  fetching_metadata: "secondary",
  downloading: "secondary",
  processing: "secondary",
  completed: "success",
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
  const { isRevealed, toggleItem } = useRevealAll()
  const revealKey = downloadRevealKey(download.id)
  const revealed = isRevealed(revealKey)
  const toggleReveal = () => toggleItem(revealKey)
  const cancellable = CANCELLABLE_STATUSES.has(download.status)
  const displayName = download.title ?? download.url
  // What the visible title shows: a private download's name stays hashed until revealed, and so do the labels.
  const maskedName = download.blurred && !revealed ? hashText(displayName) : displayName
  const thumbnailSrc = remoteThumbnailSrc(download.thumbnail)

  return (
    <div
      data-download-id={download.id}
      data-state={selected ? "selected" : undefined}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      className="flex cursor-default select-none items-center gap-4 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
    >
      <Checkbox checked={selected} onCheckedChange={onSelectedChange} aria-label={`Select ${maskedName}`} />

      <div className="h-14 w-24 flex-shrink-0 overflow-hidden rounded bg-muted">
        {thumbnailSrc ? (
          <BlurredThumbnail
            src={thumbnailSrc}
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
                <p
                  className={cn("cursor-pointer truncate text-sm font-medium", REVEAL_TEXT_FOCUS_CLASS)}
                  {...revealToggleProps(revealed, toggleReveal, "title")}
                >
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
            <Progress value={download.percent} className="h-1.5" aria-label="Download progress" />
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
        <TooltipIconButton
          label="Cancel"
          variant="ghost"
          size="icon"
          onClick={() => cancelDownload.mutate(download.id)}
          disabled={cancelDownload.isPending}
        >
          <X className="h-4 w-4" />
        </TooltipIconButton>
      )}
    </div>
  )
}

import { useState } from "react"
import { Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { useCancelDownload, useDeleteDownload } from "@/hooks/useDownloads"
import { formatEta, formatSpeed } from "@/lib/utils"
import type { Download } from "@/types/api"

const CANCELLABLE_STATUSES = new Set(["queued", "fetching_metadata", "downloading", "processing"])

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

export function DownloadQueueItem({ download }: { download: Download }) {
  const cancelDownload = useCancelDownload()
  const deleteDownload = useDeleteDownload()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const cancellable = CANCELLABLE_STATUSES.has(download.status)

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border p-3">
      <div className="h-14 w-24 flex-shrink-0 overflow-hidden rounded bg-muted">
        {download.thumbnail ? (
          <BlurredThumbnail
            src={download.thumbnail}
            className="h-full w-full object-cover"
            blurred={download.blurred}
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{download.title ?? download.url}</p>
          <Badge variant={STATUS_VARIANT[download.status] ?? "outline"}>{download.status}</Badge>
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
          <p className="text-xs text-muted-foreground">{download.status}</p>
        )}
      </div>

      {cancellable ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => cancelDownload.mutate(download.id)}
          disabled={cancelDownload.isPending}
          title="Cancel"
        >
          <X className="h-4 w-4" />
        </Button>
      ) : (
        <Button variant="ghost" size="icon" onClick={() => setDeleteOpen(true)} title="Delete">
          <Trash2 className="h-4 w-4" />
        </Button>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this from the downloads list?</AlertDialogTitle>
            <AlertDialogDescription>
              The downloaded file isn't affected — only this history entry is removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteDownload.mutate(download.id)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

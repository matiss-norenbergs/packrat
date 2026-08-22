import { useEffect, useState } from "react"
import { Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FrameMatchResult } from "./FrameMatchResult"
import { useFrameMatchStatus, useSetLibraryThumbnail, useStartFrameMatch } from "@/hooks/useLibrary"
import { formatDuration } from "@/lib/utils"
import type { FrameMatchMode, LibraryItem } from "@/types/api"

interface FrameMatchDialogProps {
  item: LibraryItem
  mode: FrameMatchMode
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FrameMatchDialog({ item, mode, open, onOpenChange }: FrameMatchDialogProps) {
  const startMatch = useStartFrameMatch()
  const setThumbnail = useSetLibraryThumbnail()
  const [jobId, setJobId] = useState<string | null>(null)
  const { data: status } = useFrameMatchStatus(jobId)

  // Kick off a fresh match every time the dialog opens — jobId resets
  // synchronously so a re-open never briefly shows the previous job's
  // stale result before the new one starts.
  useEffect(() => {
    if (!open) return
    setJobId(null)
    startMatch.mutate(
      { id: item.id, mode },
      { onSuccess: (res) => setJobId(res.jobId) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.id, mode])

  const isError = status?.state === "error" || startMatch.isError
  const isDone = status?.state === "done" && status.imageBase64 != null && status.referenceImageBase64 != null
  const isRunning = !isDone && !isError

  const referenceUrl = status?.referenceImageBase64 ? `data:image/jpeg;base64,${status.referenceImageBase64}` : ""
  const foundUrl = status?.imageBase64 ? `data:image/jpeg;base64,${status.imageBase64}` : ""

  const handleUse = () => {
    if (!status?.imageBase64) return
    setThumbnail.mutate(
      { id: item.id, imageBase64: status.imageBase64 },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[80vw] max-h-[90vh] min-w-0 overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isDone ? "Match found" : "Finding matching frame"}</DialogTitle>
          <DialogDescription>
            {isDone
              ? `Found at ${formatDuration(status.timestampSeconds ?? null)}. Compare against the reference before using it.`
              : "Scanning the video for a frame close to this thumbnail. This can take a minute or two for longer videos."}
          </DialogDescription>
        </DialogHeader>

        {isRunning && !isError && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2Icon className="h-4 w-4 animate-spin" />
            Checking candidate frames…
          </div>
        )}

        {isError && (
          <p className="py-4 text-sm text-destructive">
            {status?.error ?? startMatch.error?.message ?? "Matching failed."}
          </p>
        )}

        {isDone && (
          <FrameMatchResult
            libraryItemId={item.id}
            referenceUrl={referenceUrl}
            foundUrl={foundUrl}
            timestampSeconds={status.timestampSeconds ?? null}
            score={status.score ?? 0}
            itemTitle={item.title}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {isDone && (
            <Button onClick={handleUse} disabled={setThumbnail.isPending}>
              Use this frame
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

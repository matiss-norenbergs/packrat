import { useEffect, useRef, useState } from "react"
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
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  useAcceptLibraryItemTrim,
  useDiscardLibraryItemTrim,
  usePreviewLibraryItemTrim,
  useProbeLibraryItemMetadata,
} from "@/hooks/useLibrary"
import { mediaFileUrl } from "@/lib/api"
import { isAudioFilename } from "@/lib/utils"
import type { LibraryItem, TrimPreviewRequest, TrimPreviewResult } from "@/types/api"

interface TrimLibraryItemDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

// mm:ss.mmm — unlike formatDuration() (whole seconds, for display lists),
// trim points need millisecond precision visible so the frame-nudge buttons'
// effect is legible.
function formatPreciseTime(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds)
  const m = Math.floor(clamped / 60)
  const s = Math.floor(clamped % 60)
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000)
  return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`
}

const MIN_KEPT_RANGE = 0.05

export function TrimLibraryItemDialog({ item, open, onOpenChange }: TrimLibraryItemDialogProps) {
  const isAudio = isAudioFilename(item.filename)
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null)

  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(item.duration ?? 0)
  const [frameRate, setFrameRate] = useState(0)
  const [previewResult, setPreviewResult] = useState<TrimPreviewResult | null>(null)
  const [playbackSource, setPlaybackSource] = useState<"original" | "preview">("original")
  const [acceptConfirmOpen, setAcceptConfirmOpen] = useState(false)

  const probeMetadata = useProbeLibraryItemMetadata()
  const previewTrim = usePreviewLibraryItemTrim()
  const acceptTrim = useAcceptLibraryItemTrim()
  const discardTrim = useDiscardLibraryItemTrim()

  // `open` is externally controlled (no DialogTrigger) — Radix only invokes
  // onOpenChange for user-driven interactions (Escape/close button), never
  // for an outside setState flipping the `open` prop to true. So the reset
  // has to live in an effect keyed on `open` itself, not in onOpenChange.
  useEffect(() => {
    if (!open) return
    setTrimStart(0)
    setTrimEnd(item.duration ?? 0)
    setFrameRate(0)
    setPreviewResult(null)
    setPlaybackSource("original")
    probeMetadata.mutate(item.id, {
      onSuccess: (result) => setFrameRate(result.frameRate),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.id])

  // Best-effort clean up an unaccepted preview file when the dialog closes
  // via Cancel/X/Escape (not Accept — that path clears previewResult itself
  // before calling onOpenChange directly).
  const handleOpenChange = (next: boolean) => {
    if (!next && previewResult) {
      discardTrim.mutate({ id: item.id, previewPath: previewResult.previewPath })
      setPreviewResult(null)
    }
    onOpenChange(next)
  }

  const frameStep = frameRate > 0 ? 1 / frameRate : 0.04
  const hasHeadTrim = trimStart > 0.001
  const hasTailTrim = item.duration != null && trimEnd < item.duration - 0.001
  const validRange = trimEnd - trimStart >= MIN_KEPT_RANGE
  const canGenerate = validRange && (hasHeadTrim || hasTailTrim) && !previewTrim.isPending

  const nudgeStart = (delta: number) => {
    setTrimStart((v) => Math.min(Math.max(0, v + delta), Math.max(0, trimEnd - MIN_KEPT_RANGE)))
  }
  const nudgeEnd = (delta: number) => {
    const max = item.duration ?? Number.POSITIVE_INFINITY
    setTrimEnd((v) => Math.min(Math.max(trimStart + MIN_KEPT_RANGE, v + delta), max))
  }

  const handleGeneratePreview = () => {
    const payload: TrimPreviewRequest = {}
    if (hasHeadTrim) payload.trimStartSeconds = trimStart
    if (hasTailTrim) payload.trimEndSeconds = trimEnd
    previewTrim.mutate(
      { id: item.id, payload },
      {
        onSuccess: (result) => {
          setPreviewResult(result)
          setPlaybackSource("preview")
        },
      },
    )
  }

  const handleDiscardPreview = () => {
    if (!previewResult) return
    discardTrim.mutate({ id: item.id, previewPath: previewResult.previewPath })
    setPreviewResult(null)
    setPlaybackSource("original")
  }

  const handleConfirmAccept = () => {
    if (!previewResult) return
    acceptTrim.mutate(
      { id: item.id, previewPath: previewResult.previewPath },
      {
        onSuccess: () => {
          setAcceptConfirmOpen(false)
          setPreviewResult(null)
          onOpenChange(false)
        },
      },
    )
  }

  const mediaUrl =
    playbackSource === "preview" && previewResult ? mediaFileUrl(previewResult.previewPath) : mediaFileUrl(item.path)

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Trim</DialogTitle>
            <DialogDescription>
              Cut a precise portion off the start and/or end. Generate a preview to compare before it overwrites the
              original — trimming is not reversible once accepted.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-hidden rounded-md bg-black">
            {isAudio ? (
              <audio key={mediaUrl} ref={mediaRef} controls className="w-full">
                <source src={mediaUrl} />
              </audio>
            ) : (
              <video key={mediaUrl} ref={mediaRef} controls className="max-h-[40vh] w-full object-contain">
                <source src={mediaUrl} />
              </video>
            )}
          </div>

          {previewResult && (
            <div className="flex items-center justify-center gap-1 rounded-md border p-1 text-sm">
              <Button
                type="button"
                size="sm"
                variant={playbackSource === "original" ? "default" : "ghost"}
                onClick={() => setPlaybackSource("original")}
              >
                Original
              </Button>
              <Button
                type="button"
                size="sm"
                variant={playbackSource === "preview" ? "default" : "ghost"}
                onClick={() => setPlaybackSource("preview")}
              >
                Preview
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TrimPointField
              label="Start"
              value={trimStart}
              onChange={(v) => setTrimStart(Math.min(Math.max(0, v), Math.max(0, trimEnd - MIN_KEPT_RANGE)))}
              onNudge={nudgeStart}
              onSetToCurrent={() => setTrimStart(mediaRef.current?.currentTime ?? trimStart)}
              frameStep={frameStep}
            />
            <TrimPointField
              label="End"
              value={trimEnd}
              onChange={(v) =>
                setTrimEnd(Math.min(Math.max(trimStart + MIN_KEPT_RANGE, v), item.duration ?? Number.POSITIVE_INFINITY))
              }
              onNudge={nudgeEnd}
              onSetToCurrent={() => setTrimEnd(mediaRef.current?.currentTime ?? trimEnd)}
              frameStep={frameStep}
            />
          </div>

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <div className="flex gap-2">
              {previewResult && (
                <Button type="button" variant="outline" onClick={handleDiscardPreview} disabled={discardTrim.isPending}>
                  Discard preview
                </Button>
              )}
              <Button type="button" variant="outline" onClick={handleGeneratePreview} disabled={!canGenerate}>
                {previewTrim.isPending ? "Processing…" : previewResult ? "Regenerate preview" : "Generate preview"}
              </Button>
            </div>
            <Button type="button" onClick={() => setAcceptConfirmOpen(true)} disabled={!previewResult || acceptTrim.isPending}>
              Accept
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={acceptConfirmOpen} onOpenChange={setAcceptConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the original file with this trimmed version?</AlertDialogTitle>
            <AlertDialogDescription>The original will be overwritten. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAccept}>Replace original</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function TrimPointField({
  label,
  value,
  onChange,
  onNudge,
  onSetToCurrent,
  frameStep,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  onNudge: (delta: number) => void
  onSetToCurrent: () => void
  frameStep: number
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">{formatPreciseTime(value)}</span>
      </div>
      <div className="flex gap-2">
        <Input
          type="number"
          step={0.01}
          min={0}
          value={value.toFixed(3)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full"
        />
        <Button type="button" variant="outline" size="sm" onClick={onSetToCurrent}>
          Use current
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="outline" size="sm" onClick={() => onNudge(-1)}>
          -1s
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onNudge(-0.1)}>
          -0.1s
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onNudge(-frameStep)}>
          -1 frame
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onNudge(frameStep)}>
          +1 frame
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onNudge(0.1)}>
          +0.1s
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onNudge(1)}>
          +1s
        </Button>
      </div>
    </div>
  )
}

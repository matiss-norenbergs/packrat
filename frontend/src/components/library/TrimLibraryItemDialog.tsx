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
import { TrimFramePickerDialog } from "./TrimFramePickerDialog"
import { mediaFileUrl } from "@/lib/api"
import { formatPreciseTime, isAudioFilename } from "@/lib/utils"
import type { LibraryItem, TrimPreviewRequest, TrimPreviewResult } from "@/types/api"

interface TrimLibraryItemDialogProps {
  item: LibraryItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

const MIN_KEPT_RANGE = 0.05

// The frame picker only stays fast/browsable for a short window — mirrors
// the backend's downloader.MaxFrameWindowSeconds so the button disables
// itself before firing a request that's guaranteed to fail.
const MAX_FRAME_WINDOW_SECONDS = 15

export function TrimLibraryItemDialog({ item, open, onOpenChange }: TrimLibraryItemDialogProps) {
  const isAudio = isAudioFilename(item.filename)
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null)

  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(item.duration ?? 0)
  const [frameRate, setFrameRate] = useState(0)
  const [previewResult, setPreviewResult] = useState<TrimPreviewResult | null>(null)
  const [playbackSource, setPlaybackSource] = useState<"original" | "preview">("original")
  const [acceptConfirmOpen, setAcceptConfirmOpen] = useState(false)
  const [startPickerOpen, setStartPickerOpen] = useState(false)
  const [endPickerOpen, setEndPickerOpen] = useState(false)

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

  const startWindowLength = trimStart
  const endWindowLength = item.duration != null ? item.duration - trimEnd : 0
  const canPickStartFrame = startWindowLength > 0 && startWindowLength <= MAX_FRAME_WINDOW_SECONDS
  const canPickEndFrame = endWindowLength > 0 && endWindowLength <= MAX_FRAME_WINDOW_SECONDS

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
        <DialogContent className="sm:max-w-[95vw] max-h-[95vh] overflow-y-auto">
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
              <video key={mediaUrl} ref={mediaRef} controls className="max-h-[65vh] w-full object-contain">
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
              onPickFrame={() => setStartPickerOpen(true)}
              pickFrameDisabled={!canPickStartFrame}
              pickFrameDisabledReason={
                startWindowLength <= 0
                  ? "Move Start past 0:00.000 first"
                  : `Only available for ranges up to ${MAX_FRAME_WINDOW_SECONDS}s — narrow Start first`
              }
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
              onPickFrame={() => setEndPickerOpen(true)}
              pickFrameDisabled={!canPickEndFrame}
              pickFrameDisabledReason={
                endWindowLength <= 0
                  ? "Move End before the very end first"
                  : `Only available for ranges up to ${MAX_FRAME_WINDOW_SECONDS}s — narrow End first`
              }
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

      <TrimFramePickerDialog
        item={item}
        open={startPickerOpen}
        onOpenChange={setStartPickerOpen}
        windowStart={0}
        windowEnd={trimStart}
        onPick={setTrimStart}
      />
      <TrimFramePickerDialog
        item={item}
        open={endPickerOpen}
        onOpenChange={setEndPickerOpen}
        windowStart={trimEnd}
        windowEnd={item.duration ?? trimEnd}
        onPick={setTrimEnd}
      />

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
  onPickFrame,
  pickFrameDisabled,
  pickFrameDisabledReason,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  onNudge: (delta: number) => void
  onSetToCurrent: () => void
  frameStep: number
  onPickFrame: () => void
  pickFrameDisabled: boolean
  pickFrameDisabledReason: string
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={onPickFrame}
        disabled={pickFrameDisabled}
        title={pickFrameDisabled ? pickFrameDisabledReason : undefined}
      >
        Pick exact frame…
      </Button>
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

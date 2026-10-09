import { useEffect, useState } from "react"
import { Film } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ThumbnailFrameRangeSlider } from "@/components/ThumbnailFrameRangeSlider"
import { useSettings } from "@/hooks/useSettings"

export const MIN_CUSTOM_FRAME_COUNT = 1
export const MAX_CUSTOM_FRAME_COUNT = 50

export interface ThumbnailPickOptions {
  count: number
  low: number
  high: number
}

interface ThumbnailCustomRangeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (options: ThumbnailPickOptions) => void
}

// First step of "Choose from Video (custom)…": the frame count and pick range
// for this one run, prefilled from Settings every time it opens (nothing is
// remembered between runs).
export function ThumbnailCustomRangeDialog({ open, onOpenChange, onConfirm }: ThumbnailCustomRangeDialogProps) {
  const { data: settings } = useSettings()
  // Kept as a string so the field can be cleared/retyped; parsed on confirm.
  const [countText, setCountText] = useState("4")
  const [low, setLow] = useState(5)
  const [high, setHigh] = useState(100)

  useEffect(() => {
    if (!open) return
    setCountText(String(settings?.thumbnailFrameCount ?? 4))
    setLow(settings?.thumbnailFrameRangeLow ?? 5)
    setHigh(settings?.thumbnailFrameRangeHigh ?? 100)
    // Only re-seed on (re)open — a settings refetch mid-edit shouldn't clobber input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const count = Number(countText)
  const countValid = Number.isInteger(count) && count >= MIN_CUSTOM_FRAME_COUNT && count <= MAX_CUSTOM_FRAME_COUNT

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose from video (custom)</DialogTitle>
          <DialogDescription>
            Pick how many frames to extract and which portion of the video to pull them from, just for this run.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="thumbnail-custom-frame-count">Frame count</Label>
            <Input
              id="thumbnail-custom-frame-count"
              type="number"
              min={MIN_CUSTOM_FRAME_COUNT}
              max={MAX_CUSTOM_FRAME_COUNT}
              step={1}
              value={countText}
              onChange={(e) => setCountText(e.target.value)}
              className="w-32"
              aria-invalid={!countValid}
            />
            <p className={`text-xs ${countValid ? "text-muted-foreground" : "text-destructive"}`}>
              {MIN_CUSTOM_FRAME_COUNT}–{MAX_CUSTOM_FRAME_COUNT} frames
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Pick range</Label>
            <ThumbnailFrameRangeSlider
              low={low}
              high={high}
              onCommit={(newLow, newHigh) => {
                setLow(newLow)
                setHigh(newHigh)
              }}
            />
            <p className="text-xs text-muted-foreground">
              {low}% – {high}% of the video's duration
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!countValid} onClick={() => onConfirm({ count, low, high })}>
            <Film /> Extract frames
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

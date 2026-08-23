import { Slider as SliderPrimitive } from "radix-ui"
import { useEffect, useState } from "react"

interface ThumbnailFrameRangeSliderProps {
  low: number
  high: number
  onCommit: (low: number, high: number) => void
}

// Plain 0-100 percent range, unlike ResolutionTierSlider's resolution-step
// index mapping and colored low/medium/high segments — just the one
// selected-range segment, so this doesn't share that component's machinery.
export function ThumbnailFrameRangeSlider({ low, high, onCommit }: ThumbnailFrameRangeSliderProps) {
  const committedValue = [low, high]

  // Local drag state — onValueChange updates this continuously so the track
  // recolors live; the settings PATCH only fires from onValueCommit (pointer
  // up), so dragging never spams the API.
  const [dragValue, setDragValue] = useState<number[]>(committedValue)

  useEffect(() => {
    setDragValue(committedValue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [low, high])

  const handleCommit = (value: number[]) => {
    onCommit(value[0], value[1])
  }

  return (
    <div className="space-y-1.5 pt-1">
      <SliderPrimitive.Root
        className="relative flex h-4 w-full touch-none items-center select-none"
        min={0}
        max={100}
        step={1}
        minStepsBetweenThumbs={1}
        value={dragValue}
        onValueChange={setDragValue}
        onValueCommit={handleCommit}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
          <div
            className="absolute h-full bg-primary"
            style={{ left: `${dragValue[0]}%`, width: `${dragValue[1] - dragValue[0]}%` }}
          />
        </SliderPrimitive.Track>
        {dragValue.map((_, i) => (
          <SliderPrimitive.Thumb
            key={i}
            className="block h-4 w-4 shrink-0 rounded-full border border-border bg-background shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        ))}
      </SliderPrimitive.Root>
      <div className="relative h-3.5 text-[10px] text-muted-foreground">
        <span className="absolute left-0">0%</span>
        <span className="absolute right-0">100%</span>
      </div>
    </div>
  )
}

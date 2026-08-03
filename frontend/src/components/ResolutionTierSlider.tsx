import { Slider as SliderPrimitive } from "radix-ui"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { RESOLUTION_STEP_LABELS, RESOLUTION_STEPS } from "@/lib/resolution"

interface ResolutionTierSliderProps {
  mediumEnabled: boolean
  low: number
  high: number
  onCommit: (low: number, high: number) => void
}

const TRACK_COLOR = {
  low: "bg-red-500",
  medium: "bg-yellow-500",
  high: "bg-green-500",
} as const

const MAX_INDEX = RESOLUTION_STEPS.length - 1

function heightToIndex(height: number): number {
  const idx = RESOLUTION_STEPS.indexOf(height as (typeof RESOLUTION_STEPS)[number])
  return idx === -1 ? 0 : idx
}

function indexToPercent(index: number): number {
  return (index / MAX_INDEX) * 100
}

// Purpose-built for this one setting — colored track segments and a
// variable 1-or-2-thumb count aren't something a generic ui/slider.tsx
// primitive would gain anything from abstracting yet, so this talks to
// radix-ui's Slider directly rather than wrapping a shared primitive.
export function ResolutionTierSlider({ mediumEnabled, low, high, onCommit }: ResolutionTierSliderProps) {
  const lowIndex = heightToIndex(low)
  const highIndex = heightToIndex(high)
  const committedValue = mediumEnabled ? [lowIndex, highIndex] : [highIndex]

  // Local drag state — onValueChange updates this continuously so the track
  // recolors live; the settings PATCH only fires from onValueCommit (pointer
  // up), so dragging never spams the API.
  const [dragValue, setDragValue] = useState<number[]>(committedValue)

  useEffect(() => {
    setDragValue(committedValue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediumEnabled, low, high])

  const dragHighIndex = mediumEnabled ? dragValue[1] : dragValue[0]
  const highPct = indexToPercent(dragHighIndex)
  // With medium off there's only one boundary (highPct) — everything below
  // it is "low", so the red segment's right edge is highPct, not a
  // (nonexistent) low-thumb position.
  const lowPct = mediumEnabled ? indexToPercent(dragValue[0]) : highPct

  const handleCommit = (value: number[]) => {
    const newHigh = RESOLUTION_STEPS[mediumEnabled ? value[1] : value[0]]
    const newLow = mediumEnabled ? RESOLUTION_STEPS[value[0]] : low
    onCommit(newLow, newHigh)
  }

  return (
    <div className="space-y-1.5 pt-1">
      <SliderPrimitive.Root
        className="relative flex h-4 w-full touch-none items-center select-none"
        min={0}
        max={MAX_INDEX}
        step={1}
        minStepsBetweenThumbs={1}
        value={dragValue}
        onValueChange={setDragValue}
        onValueCommit={handleCommit}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
          <div className={cn("absolute h-full", TRACK_COLOR.low)} style={{ left: 0, width: `${lowPct}%` }} />
          {mediumEnabled && (
            <div
              className={cn("absolute h-full", TRACK_COLOR.medium)}
              style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
            />
          )}
          <div
            className={cn("absolute h-full", TRACK_COLOR.high)}
            style={{ left: `${highPct}%`, width: `${100 - highPct}%` }}
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
        {RESOLUTION_STEPS.map((step, idx) => (
          <span
            key={step}
            className={cn(
              "absolute",
              idx === 0 ? "left-0" : idx === MAX_INDEX ? "right-0" : "-translate-x-1/2",
            )}
            style={idx === 0 || idx === MAX_INDEX ? undefined : { left: `${indexToPercent(idx)}%` }}
          >
            {RESOLUTION_STEP_LABELS[step]}
          </span>
        ))}
      </div>
    </div>
  )
}

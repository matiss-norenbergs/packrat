import { type ReactNode, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { mediaFileUrl } from "@/lib/api"
import type { LibraryItem } from "@/types/api"

// How long each item stays featured before auto-advancing.
const ROTATE_DURATION_MS = 10_000

// The large "featured item" banner at the top of Browse — rotates through
// `items` (the most recently added, most-recent first), one at a time, with
// an Instagram-stories-style segmented bar showing progress through the
// current item's dwell time. Hovering the banner pauses rotation (same
// "stories" convention); the separate click-to-pause toggle persists
// independently of hover, so an explicit pause survives the mouse leaving
// and only resumes on an explicit un-pause. Callers are responsible for
// picking non-private items — this component never checks item.blurred
// itself, since a hero has no reveal-to-view affordance the way a tile does.
export function BrowseHero({ items }: { items: LibraryItem[] }) {
  const [index, setIndex] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [manuallyPaused, setManuallyPaused] = useState(false)
  const paused = hovered || manuallyPaused

  // Defensive clamp if the list shrinks (e.g. a background refetch) while
  // rotated further along than the new length allows.
  useEffect(() => {
    if (index >= items.length) setIndex(0)
  }, [items.length, index])

  const item = items[index]
  const canRotate = items.length > 1

  if (!item) return null

  const goTo = (i: number) => setIndex(((i % items.length) + items.length) % items.length)

  return (
    <div
      className="group/hero relative flex h-[50vh] min-h-72 w-full items-end overflow-hidden md:h-[60vh]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {item.thumbnail ? (
        <img src={mediaFileUrl(item.thumbnail)} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-muted" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
      {canRotate && <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/50 to-transparent" />}

      {canRotate && (
        <div className="absolute inset-x-2 top-2 z-10 space-y-2 md:inset-x-4">
          <div className="flex gap-1 opacity-50 transition-opacity duration-300 group-hover/hero:opacity-100">
            {items.map((it, i) => (
              <div key={it.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                {i < index && <div className="h-full w-full bg-white" />}
                {i === index && (
                  <div
                    key={item.id}
                    className="h-full bg-white"
                    style={{
                      animation: `hero-progress-fill ${ROTATE_DURATION_MS}ms linear forwards`,
                      animationPlayState: paused ? "paused" : "running",
                    }}
                    onAnimationEnd={() => goTo(index + 1)}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover/hero:opacity-100">
            <HeroIconButton label="Previous" onClick={() => goTo(index - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </HeroIconButton>
            <HeroIconButton label={manuallyPaused ? "Play" : "Pause"} onClick={() => setManuallyPaused((p) => !p)}>
              {manuallyPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </HeroIconButton>
            <HeroIconButton label="Next" onClick={() => goTo(index + 1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </HeroIconButton>
          </div>
        </div>
      )}

      <div className="relative space-y-3 p-6 md:p-10">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recently Added</p>
        <h1 className="max-w-xl text-2xl font-bold md:text-4xl">{item.title}</h1>
        <p className="max-w-xl text-sm text-muted-foreground line-clamp-2 md:text-base">
          {item.artistName ?? item.uploader ?? item.collectionName ?? ""}
        </p>
        <Button asChild size="lg" className="gap-2">
          <Link to={`/browse/${item.id}`}>
            <Play className="h-5 w-5" />
            Play
          </Link>
        </Button>
      </div>
    </div>
  )
}

function HeroIconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur-sm hover:bg-background/95"
    >
      {children}
    </button>
  )
}

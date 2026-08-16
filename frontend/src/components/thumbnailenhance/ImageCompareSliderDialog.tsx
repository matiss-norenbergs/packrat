import { useCallback, useEffect, useRef, useState } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { GripVerticalIcon, XIcon } from "lucide-react"

interface ImageCompareSliderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  originalUrl: string
  enhancedUrl: string
  itemTitle: string
  // Corner labels — default to the AI Enhancement compare dialog's own
  // wording so that call site's props don't need updating; other reuses
  // (e.g. the frame-match dialog) pass their own.
  leftLabel?: string
  rightLabel?: string
}

// ImageCompareSliderDialog is a fullscreen, backdrop-less before/after
// viewer — the original and enhanced thumbnails are stacked exactly on top
// of each other (enhanced on top) and a draggable divider clips the top
// layer so the original shows through to its left. Sized off the original
// image's own natural rendering (object-contain, in normal flow) rather
// than a passed-in width/height, so it stays correct even if the two
// images don't share an identical aspect ratio.
export function ImageCompareSliderDialog({
  open,
  onOpenChange,
  originalUrl,
  enhancedUrl,
  itemTitle,
  leftLabel = "Original",
  rightLabel = "Enhanced",
}: ImageCompareSliderDialogProps) {
  const [dividerPercent, setDividerPercent] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  // Reset to center every time the dialog opens, so re-opening on a
  // different history entry doesn't inherit the previous drag position.
  useEffect(() => {
    if (open) setDividerPercent(50)
  }, [open])

  const updateFromClientX = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const percent = ((clientX - rect.left) / rect.width) * 100
    setDividerPercent(Math.min(100, Math.max(0, percent)))
  }, [])

  useEffect(() => {
    if (!open) return
    const handleMove = (e: PointerEvent) => {
      if (!draggingRef.current) return
      updateFromClientX(e.clientX)
    }
    const handleUp = () => {
      draggingRef.current = false
    }
    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    return () => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
    }
  }, [open, updateFromClientX])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col bg-background outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">Compare — {itemTitle}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Drag the divider to reveal the original thumbnail underneath the enhanced one.
          </DialogPrimitive.Description>

          <DialogPrimitive.Close asChild>
            <button
              type="button"
              className="absolute top-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
            >
              <XIcon className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </button>
          </DialogPrimitive.Close>

          <div className="flex flex-1 items-center justify-center overflow-hidden p-2">
            <div
              ref={containerRef}
              className="relative h-full w-full touch-none select-none cursor-ew-resize"
              onPointerDown={(e) => {
                draggingRef.current = true
                updateFromClientX(e.clientX)
              }}
            >
              <img
                src={originalUrl}
                alt="Original thumbnail"
                draggable={false}
                className="pointer-events-none block h-full w-full select-none object-contain"
              />
              <img
                src={enhancedUrl}
                alt="Enhanced thumbnail"
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                style={{ clipPath: `inset(0 0 0 ${dividerPercent}%)` }}
              />

              <div className="absolute inset-y-0 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left: `${dividerPercent}%` }}>
                <div
                  role="slider"
                  aria-label="Comparison divider"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(dividerPercent)}
                  tabIndex={0}
                  className="absolute top-1/2 left-1/2 flex h-8 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-sm border bg-white text-black shadow-lg"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    draggingRef.current = true
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft") setDividerPercent((p) => Math.max(0, p - 5))
                    if (e.key === "ArrowRight") setDividerPercent((p) => Math.min(100, p + 5))
                  }}
                >
                  <GripVerticalIcon className="h-4 w-4" />
                </div>
              </div>

              <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                {leftLabel}
              </span>
              <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                {rightLabel}
              </span>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

import { useCallback, useMemo, useState, type PointerEvent } from "react"

/**
 * Open/close state for a Popover that also opens on hover — for a *mouse* only.
 *
 * Radix Popover has no hover mode, so the trigger and the content both get `hoverProps`: moving the mouse off the small
 * trigger onto the content must not close it. Touch and pen never hover: a tap fires the browser's compatibility
 * `mouseenter` first and the `click` right after it, so mouse events would open the popover and the click would
 * immediately toggle it shut. Pointer events carry `pointerType`, so only `"mouse"` drives hover and a tap is just the
 * trigger's normal click toggle (as is keyboard Enter/Space; Escape closes through Radix).
 */
export function useHoverPopover() {
  const [open, setOpen] = useState(false)
  const onPointerEnter = useCallback((e: PointerEvent) => {
    if (e.pointerType === "mouse") setOpen(true)
  }, [])
  const onPointerLeave = useCallback((e: PointerEvent) => {
    if (e.pointerType === "mouse") setOpen(false)
  }, [])
  const hoverProps = useMemo(() => ({ onPointerEnter, onPointerLeave }), [onPointerEnter, onPointerLeave])
  return { open, onOpenChange: setOpen, hoverProps }
}

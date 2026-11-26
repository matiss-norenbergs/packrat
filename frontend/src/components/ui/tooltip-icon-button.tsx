import * as React from "react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type TooltipIconButtonProps = React.ComponentProps<typeof Button> & {
  /**
   * The button's name: the tooltip text *and* its `aria-label`. A Radix tooltip only describes its
   * trigger while it is open and never opens on touch, so without the label a screen reader or
   * TalkBack announces just "button".
   */
  label: string
  /** Tooltip content when it should say more than the label (the label stays the accessible name). */
  tooltip?: React.ReactNode
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"]
  tooltipClassName?: string
}

/**
 * An icon-only `Button` (or, with `asChild`, a link styled as one) with a tooltip, named for
 * assistive technology. Renders exactly what `<Tooltip><TooltipTrigger asChild><Button …/>` did
 * before (no wrapper element), so look, sizes and tooltip behaviour are unchanged. Every other prop
 * (variant, size, className, disabled, `aria-pressed`, ref, …) goes to the `Button`.
 *
 * Labels must never contain unmasked private names: pass a generic label or the masked text.
 */
function TooltipIconButton({
  label,
  tooltip,
  tooltipSide,
  tooltipClassName,
  ...props
}: TooltipIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className={tooltipClassName}>
        {tooltip ?? label}
      </TooltipContent>
    </Tooltip>
  )
}

export { TooltipIconButton }
export type { TooltipIconButtonProps }

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Joins its children (Buttons, also when a Tooltip/Popover/DropdownMenu trigger renders one with `asChild`, which adds
// no DOM) into one control: a single shared border, squared inner corners, rounded outer corners. The selectors are
// `>*:not(:first-child)` style, so they have higher specificity than a Button's own radius classes and a one-child
// group looks exactly like the lone Button. The focused child is lifted (z-10) so its ring is not covered by a neighbor.
const buttonGroupVariants = cva(
  "flex w-fit items-stretch [&>*]:focus-visible:relative [&>*]:focus-visible:z-10",
  {
    variants: {
      orientation: {
        horizontal:
          "[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none",
        vertical:
          "flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:border-t-0 [&>*:not(:last-child)]:rounded-b-none",
      },
    },
    defaultVariants: { orientation: "horizontal" },
  },
)

function ButtonGroup({
  className,
  orientation,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation ?? "horizontal"}
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  )
}

export { ButtonGroup, buttonGroupVariants }

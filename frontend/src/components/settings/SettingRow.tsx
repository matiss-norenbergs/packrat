import type { ReactNode } from "react"
import { Label } from "@/components/ui/label"

// A settings row: label and visible description on the left, the control on the right. Stacks
// (label above control) on narrow widths. Rows in the same card are separated by a divider.
export function SettingRow({
  label,
  htmlFor,
  description,
  children,
}: {
  label: string
  htmlFor: string
  description: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="space-y-1">
        <Label htmlFor={htmlFor}>{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

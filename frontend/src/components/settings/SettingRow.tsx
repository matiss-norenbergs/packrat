import type { ReactNode } from "react"
import { FieldLabel } from "@/components/ui/info-popover"

// A settings row: label with its info icon, the control on a second row below it. Rows in the
// same card are separated by a divider.
export function SettingRow({
  label,
  htmlFor,
  info,
  children,
}: {
  label: string
  htmlFor: string
  info: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <FieldLabel htmlFor={htmlFor} info={info}>
        {label}
      </FieldLabel>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

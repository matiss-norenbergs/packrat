import type { ReactNode } from "react"
import type { NameType, Payload, ValueType } from "recharts/types/component/DefaultTooltipContent"

interface ChartTooltipContentProps {
  active?: boolean
  payload?: readonly Payload<ValueType, NameType>[]
  label?: ReactNode
}

// Shared tooltip content for every dashboard chart — Recharts' own default
// tooltip is a raw white box that ignores dark mode, so this renders it
// through the app's existing popover surface/border/text tokens instead.
export function ChartTooltipContent({ active, payload, label }: ChartTooltipContentProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      {label != null && <p className="mb-1 font-medium">{label}</p>}
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span> {entry.value}
        </p>
      ))}
    </div>
  )
}

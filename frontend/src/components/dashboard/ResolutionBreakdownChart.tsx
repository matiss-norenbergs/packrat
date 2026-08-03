import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useResolutionBreakdown } from "@/hooks/useStats"
import { RESOLUTION_STEP_LABELS } from "@/lib/resolution"
import { ChartTooltipContent } from "./ChartTooltip"

// Single series (item count per standard resolution step) — sequential
// blue, no legend needed (the card title already says what's plotted).
export function ResolutionBreakdownChart() {
  const { data: points, isLoading } = useResolutionBreakdown()

  const total = points?.reduce((sum, p) => sum + p.count, 0) ?? 0
  const data = points?.map((p) => ({ label: RESOLUTION_STEP_LABELS[p.step] ?? `${p.step}p`, count: p.count })) ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Items by Resolution</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !points ? (
          <Skeleton className="h-64 w-full" />
        ) : total === 0 ? (
          <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">No data yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={256}>
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip content={<ChartTooltipContent />} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="count" name="Items" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

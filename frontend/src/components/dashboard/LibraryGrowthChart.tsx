import { format, parseISO } from "date-fns"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useLibraryGrowth } from "@/hooks/useStats"
import { ChartTooltipContent } from "./ChartTooltip"

// Single series (cumulative library size over time) — sequential blue,
// no legend needed (the card title already says what's plotted).
export function LibraryGrowthChart() {
  const { data: points, isLoading } = useLibraryGrowth()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Library Growth</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !points ? (
          <Skeleton className="h-64 w-full" />
        ) : points.length === 0 ? (
          <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">No data yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={256}>
            <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => format(parseISO(d), "MMM d")}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
                minTickGap={32}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip
                content={({ active, payload, label }) => (
                  <ChartTooltipContent
                    active={active}
                    payload={payload}
                    label={typeof label === "string" ? format(parseISO(label), "MMM d, yyyy") : label}
                  />
                )}
              />
              <Area
                type="monotone"
                dataKey="cumulative"
                name="Items"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="var(--chart-1)"
                fillOpacity={0.12}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

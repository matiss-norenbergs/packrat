import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useStats } from "@/hooks/useStats"
import { formatBytes } from "@/lib/utils"
import { ChartTooltipContent } from "./ChartTooltip"

// Three categories (Packrat's own usage, other usage on the same disk, free
// space) — a donut works here because the parts genuinely sum to a
// meaningful whole (total disk size), unlike the 2-slice video/audio split
// above which uses a stacked bar instead.
export function StorageChart() {
  const { data: stats, isLoading } = useStats()

  const hasDiskInfo = !!stats && stats.diskTotalBytes > 0
  const packrat = stats?.totalStorageBytes ?? 0
  const free = stats?.diskFreeBytes ?? 0
  const other = hasDiskInfo ? Math.max(0, stats!.diskTotalBytes - free - packrat) : 0

  const data = [
    { name: "Packrat", value: packrat, color: "var(--chart-1)" },
    { name: "Other", value: other, color: "var(--chart-2)" },
    { name: "Free", value: free, color: "var(--chart-3)" },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Storage</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !stats ? (
          <Skeleton className="h-64 w-full" />
        ) : !hasDiskInfo ? (
          <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">No data yet</p>
        ) : (
          <div className="flex h-64 flex-col justify-center gap-4">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Tooltip
                  content={({ active, payload }) => (
                    <ChartTooltipContent
                      active={active}
                      payload={payload?.map((p) => ({ ...p, value: formatBytes(Number(p.value)) }))}
                    />
                  )}
                />
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="60%"
                  outerRadius="90%"
                  strokeWidth={2}
                  stroke="var(--card)"
                >
                  {data.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-sm">
              {data.map((entry) => (
                <LegendEntry key={entry.name} color={entry.color} label={entry.name} value={formatBytes(entry.value)} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LegendEntry({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSettings } from "@/hooks/useSettings"
import { useTags } from "@/hooks/useTags"
import { ChartTooltipContent } from "./ChartTooltip"

const MAX_BARS = 8

// Same shape as TopCollectionsChart — single series, one hue, private tags
// excluded entirely when privacy is enabled.
export function TopTagsChart() {
  const { data: tags, isLoading } = useTags()
  const { data: settings } = useSettings()

  const rows = (tags ?? [])
    .filter((t) => t.usageCount > 0)
    .filter((t) => !settings?.privacyEnabled || !t.isPrivate)
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, MAX_BARS)
    .map((t) => ({ name: t.name, count: t.usageCount }))
    .reverse()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Top Tags</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !tags ? (
          <Skeleton className="h-64 w-full" />
        ) : rows.length === 0 ? (
          <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">No data yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={256}>
            <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis
                type="number"
                allowDecimals={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={100}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltipContent />} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="count" name="Items" fill="var(--chart-1)" radius={[0, 4, 4, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

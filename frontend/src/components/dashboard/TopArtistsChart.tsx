import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useArtists } from "@/hooks/useArtists"
import { ChartTooltipContent } from "./ChartTooltip"

const MAX_BARS = 8

// Same shape as TopTagsChart — single series, one hue. Swapped in for
// "Top Collections": unlike collections, artist names are flat (no tree),
// so there's no risk of two different same-named collections (e.g. two
// unrelated "Season 1" folders under different shows) getting silently
// merged into one misleading bar.
export function TopArtistsChart() {
  const { data: artists, isLoading } = useArtists()

  const rows = (artists ?? [])
    .filter((a) => a.usageCount > 0)
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, MAX_BARS)
    .map((a) => ({ name: a.name, count: a.usageCount }))
    .reverse()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Top Artists</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !artists ? (
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

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useStats } from "@/hooks/useStats"
import { ChartTooltipContent } from "./ChartTooltip"

// Two categories only — a 2-slice pie/donut is a well-documented chart
// anti-pattern (near-impossible to compare two close slice angles at a
// glance). A single part-to-whole stacked bar reads faster and stays
// legible at any ratio, with a legend since there are 2 series.
export function MediaTypeBreakdownChart() {
  const { data: stats, isLoading } = useStats()

  const total = stats ? stats.libraryVideoCount + stats.libraryAudioCount : 0
  const data = stats ? [{ name: "Library", video: stats.libraryVideoCount, audio: stats.libraryAudioCount }] : []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Video vs Audio</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !stats ? (
          <Skeleton className="h-64 w-full" />
        ) : total === 0 ? (
          <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">No data yet</p>
        ) : (
          <div className="flex h-64 flex-col justify-center gap-6">
            <ResponsiveContainer width="100%" height={40}>
              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" hide />
                <Tooltip content={<ChartTooltipContent />} cursor={{ fill: "var(--muted)" }} />
                <Bar
                  dataKey="video"
                  name="Video"
                  stackId="a"
                  fill="var(--chart-1)"
                  stroke="var(--card)"
                  strokeWidth={2}
                  radius={[4, 0, 0, 4]}
                  barSize={28}
                />
                <Bar
                  dataKey="audio"
                  name="Audio"
                  stackId="a"
                  fill="var(--chart-2)"
                  stroke="var(--card)"
                  strokeWidth={2}
                  radius={[0, 4, 4, 0]}
                  barSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-center gap-6 text-sm">
              <LegendEntry color="var(--chart-1)" label="Video" value={stats.libraryVideoCount} />
              <LegendEntry color="var(--chart-2)" label="Audio" value={stats.libraryAudioCount} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LegendEntry({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

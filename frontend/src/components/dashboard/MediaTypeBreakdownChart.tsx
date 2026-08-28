import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useStats } from "@/hooks/useStats"
import { ChartTooltipContent } from "./ChartTooltip"

// Three categories — a pie/donut gets hard to compare at a glance past a
// couple of slices, so this stays a single part-to-whole stacked bar, which
// reads fine at any ratio (including a category that's legitimately zero),
// with a legend since there are 3 series.
export function MediaTypeBreakdownChart() {
  const { data: stats, isLoading } = useStats()

  const total = stats ? stats.libraryVideoCount + stats.libraryAudioCount + stats.libraryImageCount : 0
  // Ghost (no-file placeholder) items fold into the same Video/Audio/Image
  // bar segments rather than a separate series — a lighter shade of the same
  // hue (not a new color) marks the ghost sub-portion, per the dataviz
  // convention of secondary encoding for a sub-dimension split.
  const hasGhosts = stats
    ? stats.libraryVideoGhostCount + stats.libraryAudioGhostCount + stats.libraryImageGhostCount > 0
    : false
  const data = stats
    ? [
        {
          name: "Library",
          videoReal: stats.libraryVideoCount - stats.libraryVideoGhostCount,
          videoGhost: stats.libraryVideoGhostCount,
          audioReal: stats.libraryAudioCount - stats.libraryAudioGhostCount,
          audioGhost: stats.libraryAudioGhostCount,
          imageReal: stats.libraryImageCount - stats.libraryImageGhostCount,
          imageGhost: stats.libraryImageGhostCount,
        },
      ]
    : []
  // Only the very first segment (video's real portion) and the very last
  // segment (image's ghost portion, or its real portion when there are no
  // ghosts to append) get rounded outer corners — everything in between is
  // square so the stack reads as one continuous bar.
  const lastRadius: [number, number, number, number] = [0, 4, 4, 0]
  const squareRadius: [number, number, number, number] = [0, 0, 0, 0]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Media Types</CardTitle>
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
                  dataKey="videoReal"
                  name="Video"
                  stackId="a"
                  fill="var(--chart-1)"
                  stroke="var(--card)"
                  strokeWidth={2}
                  radius={[4, 0, 0, 4]}
                  barSize={28}
                />
                {hasGhosts && (
                  <Bar
                    dataKey="videoGhost"
                    name="Video (ghost)"
                    stackId="a"
                    fill="var(--chart-1)"
                    fillOpacity={0.35}
                    stroke="var(--card)"
                    strokeWidth={2}
                    radius={squareRadius}
                    barSize={28}
                  />
                )}
                <Bar
                  dataKey="audioReal"
                  name="Audio"
                  stackId="a"
                  fill="var(--chart-2)"
                  stroke="var(--card)"
                  strokeWidth={2}
                  radius={squareRadius}
                  barSize={28}
                />
                {hasGhosts && (
                  <Bar
                    dataKey="audioGhost"
                    name="Audio (ghost)"
                    stackId="a"
                    fill="var(--chart-2)"
                    fillOpacity={0.35}
                    stroke="var(--card)"
                    strokeWidth={2}
                    radius={squareRadius}
                    barSize={28}
                  />
                )}
                <Bar
                  dataKey="imageReal"
                  name="Image"
                  stackId="a"
                  fill="var(--chart-3)"
                  stroke="var(--card)"
                  strokeWidth={2}
                  radius={hasGhosts ? squareRadius : lastRadius}
                  barSize={28}
                />
                {hasGhosts && (
                  <Bar
                    dataKey="imageGhost"
                    name="Image (ghost)"
                    stackId="a"
                    fill="var(--chart-3)"
                    fillOpacity={0.35}
                    stroke="var(--card)"
                    strokeWidth={2}
                    radius={lastRadius}
                    barSize={28}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-sm">
              <LegendEntry color="var(--chart-1)" label="Video" value={stats.libraryVideoCount} />
              <LegendEntry color="var(--chart-2)" label="Audio" value={stats.libraryAudioCount} />
              <LegendEntry color="var(--chart-3)" label="Image" value={stats.libraryImageCount} />
              {hasGhosts && (
                <LegendEntry
                  color="var(--muted-foreground)"
                  opacity={0.35}
                  label="Ghost items"
                  value={
                    stats.libraryVideoGhostCount + stats.libraryAudioGhostCount + stats.libraryImageGhostCount
                  }
                />
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LegendEntry({
  color,
  label,
  value,
  opacity = 1,
}: {
  color: string
  label: string
  value: number
  opacity?: number
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, opacity }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

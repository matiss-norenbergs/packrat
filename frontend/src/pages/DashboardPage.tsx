import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useStats } from "@/hooks/useStats"
import { formatBytes } from "@/lib/utils"

export function DashboardPage() {
  const { data: stats, isLoading } = useStats()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Downloads</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !stats ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Active" value={stats.activeDownloads} />
                <Stat label="Queued" value={stats.queuedDownloads} />
                <Stat label="Completed Today" value={stats.completedToday} />
              </div>
            )}
            <p className="mt-3 text-sm text-muted-foreground">
              See the <a href="/downloads" className="underline">Downloads</a> page for active and queued downloads.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Library</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !stats ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Videos" value={stats.libraryVideoCount} />
                <Stat label="Audio Files" value={stats.libraryAudioCount} />
                <Stat label="Storage Used" value={formatBytes(stats.totalStorageBytes)} />
              </div>
            )}
            <p className="mt-3 text-sm text-muted-foreground">
              See the <a href="/library" className="underline">Library</a> page for completed downloads.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DashboardSettingsPopover } from "@/components/dashboard/DashboardSettingsPopover"
import { LibraryGrowthChart } from "@/components/dashboard/LibraryGrowthChart"
import { MediaTypeBreakdownChart } from "@/components/dashboard/MediaTypeBreakdownChart"
import { ResolutionBreakdownChart } from "@/components/dashboard/ResolutionBreakdownChart"
import { StorageChart } from "@/components/dashboard/StorageChart"
import { TopArtistsChart } from "@/components/dashboard/TopArtistsChart"
import { TopTagsChart } from "@/components/dashboard/TopTagsChart"
import { useSettings, useUpdateSettings } from "@/hooks/useSettings"
import { useStats } from "@/hooks/useStats"
import { DASHBOARD_WIDGETS } from "@/lib/dashboardWidgets"
import { formatBytes } from "@/lib/utils"

const CHART_IDS = ["libraryGrowth", "mediaTypes", "resolutions", "storage", "topArtists", "topTags"]

export function DashboardPage() {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()

  const hiddenWidgets = settings?.dashboardHiddenWidgets ?? []
  const isVisible = (id: string) => !hiddenWidgets.includes(id)
  const showStatCards = isVisible("downloads") || isVisible("library")
  const showCharts = CHART_IDS.some(isVisible)
  const allHidden = DASHBOARD_WIDGETS.every((w) => !isVisible(w.id))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <DashboardSettingsPopover
          hiddenWidgets={hiddenWidgets}
          saving={updateSettings.isPending}
          onSave={(ids) => updateSettings.mutate({ dashboardHiddenWidgets: ids })}
        />
      </div>
      {allHidden && (
        <p className="text-sm text-muted-foreground">
          All dashboard cards are hidden. Use the settings button above to show them again.
        </p>
      )}
      {showStatCards && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {isVisible("downloads") && <DownloadsCard />}
          {isVisible("library") && <LibraryCard />}
        </div>
      )}
      {showCharts && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {isVisible("libraryGrowth") && <LibraryGrowthChart />}
          {isVisible("mediaTypes") && <MediaTypeBreakdownChart />}
          {isVisible("resolutions") && <ResolutionBreakdownChart />}
          {isVisible("storage") && <StorageChart />}
          {isVisible("topArtists") && <TopArtistsChart />}
          {isVisible("topTags") && <TopTagsChart />}
        </div>
      )}
    </div>
  )
}

// Each stat card owns its useStats() call so a hidden card leaves no observer
// behind — with the stats-based cards/charts all hidden, /api/stats isn't
// requested or polled at all.
function DownloadsCard() {
  const { data: stats, isLoading } = useStats()
  return (
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
  )
}

function LibraryCard() {
  const { data: stats, isLoading } = useStats()
  const ghostCount = stats ? stats.libraryVideoGhostCount + stats.libraryAudioGhostCount + stats.libraryImageGhostCount : 0
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Library</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !stats ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <Stat label="Videos" value={stats.libraryVideoCount} />
            <Stat label="Audio Files" value={stats.libraryAudioCount} />
            <Stat label="Images" value={stats.libraryImageCount} />
            <Stat label="Storage Used" value={formatBytes(stats.totalStorageBytes)} />
          </div>
        )}
        {ghostCount > 0 && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {ghostCount} ghost {ghostCount === 1 ? "item" : "items"}
          </p>
        )}
        <p className="mt-3 text-sm text-muted-foreground">
          See the <a href="/library" className="underline">Library</a> page for completed downloads.
        </p>
      </CardContent>
    </Card>
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

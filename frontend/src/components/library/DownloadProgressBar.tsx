import { useDownloadProgress } from "@/hooks/useDownloads"
import { cn } from "@/lib/utils"

/**
 * Thin progress strip overlaid on the bottom edge of a downloading item's thumbnail (Library grid, Folders and
 * list). Mount it only for items with an active download: it subscribes to the downloads query, so plain cards
 * stay free of it. Shows nothing while the download is queued, fetching metadata or not found yet.
 * No title or percent text, so it is shown regardless of blur/reveal state.
 */
export function DownloadProgressBar({ downloadId, size }: { downloadId: number; size: "card" | "list" }) {
  const { data } = useDownloadProgress(downloadId)
  if (!data || (data.status !== "downloading" && data.status !== "processing")) return null
  // Post-download work (merge, convert) has no percent of its own: show a full bar.
  const percent = data.status === "processing" ? 100 : Math.min(100, Math.max(0, data.percent))
  return (
    <div
      role="progressbar"
      aria-label="Download progress"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-foreground/20", size === "card" ? "h-1" : "h-0.5")}
    >
      <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
    </div>
  )
}

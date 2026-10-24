import { Progress } from "@/components/ui/progress"

// The installing state of "Check for updates" / "Match server version": a label with the percent on
// the right, a bar, and the restart notice. With no known total the bar sweeps and there is no percent.
export function UpdateProgress({ downloaded, total }: { downloaded: number; total?: number | null }) {
  const percent = total ? Math.min(100, Math.round((downloaded / total) * 100)) : null
  return (
    <div className="space-y-2" data-testid="update-progress">
      <div className="flex items-center justify-between text-sm">
        <span>{percent === null ? "Downloading…" : "Downloading update…"}</span>
        {percent !== null && <span className="tabular-nums text-muted-foreground">{percent}%</span>}
      </div>
      <Progress value={percent} aria-label="Update download progress" />
      <p className="text-sm text-muted-foreground">Packrat will restart when it's done.</p>
    </div>
  )
}

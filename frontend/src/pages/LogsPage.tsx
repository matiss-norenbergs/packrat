import { useState } from "react"
import { Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { LogDetailDialog } from "@/components/logs/LogDetailDialog"
import { useLogs } from "@/hooks/useLogs"
import type { DownloadStatus, LogEntry } from "@/types/api"

const NONE = "none"

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
  interrupted: "destructive",
}

const STATUS_OPTIONS: { value: DownloadStatus; label: string }[] = [
  { value: "queued", label: "Queued" },
  { value: "fetching_metadata", label: "Fetching metadata" },
  { value: "downloading", label: "Downloading" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "interrupted", label: "Interrupted" },
]

export function LogsPage() {
  const { data, isLoading, isError, error } = useLogs()
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState(NONE)
  const [selected, setSelected] = useState<LogEntry | null>(null)

  const filtered = (data ?? []).filter((entry) => {
    if (status !== NONE && entry.status !== status) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const haystack = `${entry.title ?? entry.url} ${entry.ytdlpCommand ?? ""}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Logs</h1>
        <p className="text-sm text-muted-foreground">
          yt-dlp command, exit code, and captured stdout/stderr for each download.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[140px] flex-1 sm:min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search title, URL, or command…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-[170px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>All statuses</SelectItem>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Failed to load logs: {(error as Error).message}</p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet — logs for each download will show up here once one runs.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No logs match your search/filter.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => (
            <LogRow key={entry.id} entry={entry} onView={() => setSelected(entry)} />
          ))}
        </div>
      )}

      {selected && (
        <LogDetailDialog
          entry={selected}
          open={selected != null}
          onOpenChange={(open) => !open && setSelected(null)}
        />
      )}
    </div>
  )
}

function LogRow({ entry, onView }: { entry: LogEntry; onView: () => void }) {
  const hasLog = Boolean(entry.ytdlpCommand || entry.stdoutTail || entry.stderrTail)

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{entry.title ?? entry.url}</p>
          <Badge variant={STATUS_VARIANT[entry.status] ?? "outline"}>{entry.status}</Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{new Date(entry.createdAt).toLocaleString()}</span>
          {entry.retryCount > 0 && <span>Retries: {entry.retryCount}</span>}
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onView}
        disabled={!hasLog}
        title={hasLog ? undefined : "No log captured yet"}
      >
        View log
      </Button>
    </div>
  )
}

import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { LogDetailDialog } from "@/components/logs/LogDetailDialog"
import { useLogs } from "@/hooks/useLogs"
import { getPageNumbers } from "@/lib/pagination"
import { formatDownloadStatus } from "@/lib/utils"
import type { DownloadStatus, LogEntry } from "@/types/api"

const PAGE_SIZE = 50
const NONE = "none"

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
  interrupted: "destructive",
}

const STATUS_OPTIONS: DownloadStatus[] = [
  "queued",
  "fetching_metadata",
  "downloading",
  "processing",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]

export function LogsPage() {
  const { data, isLoading, isError, error } = useLogs()
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState(NONE)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<LogEntry | null>(null)

  const filtered = useMemo(() => {
    return (data ?? []).filter((entry) => {
      if (status !== NONE && entry.status !== status) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const haystack = `${entry.title ?? entry.url} ${entry.ytdlpCommand ?? ""}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [data, search, status])
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold">Logs</h1>
        <p className="text-sm text-muted-foreground">
          yt-dlp command, exit code, and captured stdout/stderr for each download.
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-[170px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>All statuses</SelectItem>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {formatDownloadStatus(opt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative ml-auto min-w-[160px] max-w-[280px] flex-1 sm:min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search title, URL, or command…"
            className="pl-8"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Failed to load logs: {(error as Error).message}</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing here yet — logs for each download will show up here once one runs.
          </p>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground">No logs match your search/filter.</p>
        ) : (
          // Single scroll container (both axes) via containerClassName — see
          // Table's doc comment in components/ui/table.tsx for why a second
          // overflow-y-auto wrapper would break the header's sticky positioning.
          <Table containerClassName="h-full overflow-auto rounded-md border">
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Retries</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageData.map((entry) => (
                <LogRow key={entry.id} entry={entry} onView={() => setSelected(entry)} />
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {!isLoading && data && data.length > 0 && total > 0 && (
        <div className="flex shrink-0 items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {total} {total === 1 ? "log" : "logs"}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            {getPageNumbers(page, totalPages).map((p, i) =>
              p === "ellipsis" ? (
                <span key={`ellipsis-${i}`} className="px-1.5 text-sm text-muted-foreground">
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === page ? "default" : "outline"}
                  size="sm"
                  className="w-8 px-0"
                  onClick={() => setPage(p)}
                >
                  {p}
                </Button>
              ),
            )}
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
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
    <TableRow>
      <TableCell>
        <p className="max-w-xs truncate font-medium">{entry.title ?? entry.url}</p>
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[entry.status] ?? "outline"}>{formatDownloadStatus(entry.status)}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</TableCell>
      <TableCell className="text-muted-foreground">{entry.retryCount > 0 ? entry.retryCount : "—"}</TableCell>
      <TableCell>
        {hasLog ? (
          <Button variant="outline" size="sm" onClick={onView}>
            View log
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={onView} disabled>
                View log
              </Button>
            </TooltipTrigger>
            <TooltipContent>No log captured yet</TooltipContent>
          </Tooltip>
        )}
      </TableCell>
    </TableRow>
  )
}

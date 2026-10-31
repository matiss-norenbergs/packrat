import { useMemo, useState } from "react"
import { Eye } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DataTable } from "@/components/data-table"
import type { ColumnDef } from "@/components/data-table"
import { LogDetailDialog } from "@/components/logs/LogDetailDialog"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useLogs } from "@/hooks/useLogs"
import { formatDownloadStatus } from "@/lib/utils"
import type { DownloadStatus, LogEntry } from "@/types/api"

const PAGE_SIZE = 50
const NONE = "none"

const STATUS_VARIANT: Record<string, "success" | "secondary" | "destructive" | "outline"> = {
  completed: "success",
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

const matchLog = (entry: LogEntry, q: string) =>
  `${entry.title ?? entry.url} ${entry.ytdlpCommand ?? ""}`.toLowerCase().includes(q)

const hasLog = (entry: LogEntry) => Boolean(entry.ytdlpCommand || entry.stdoutTail || entry.stderrTail)

const columns: ColumnDef<LogEntry>[] = [
  {
    key: "title",
    header: "Title",
    sortValue: (entry) => entry.title ?? entry.url,
    cell: (entry) => <p className="truncate font-medium">{entry.title ?? entry.url}</p>,
  },
  {
    key: "status",
    header: "Status",
    type: "status",
    sortValue: (entry) => formatDownloadStatus(entry.status),
    cell: (entry) => <Badge variant={STATUS_VARIANT[entry.status] ?? "outline"}>{formatDownloadStatus(entry.status)}</Badge>,
  },
  {
    key: "date",
    header: "Date",
    type: "date",
    cellClassName: "text-muted-foreground",
    sortValue: (entry) => new Date(entry.createdAt),
    cell: (entry) => new Date(entry.createdAt).toLocaleString(),
  },
  {
    key: "retries",
    header: "Retries",
    type: "number",
    cellClassName: "text-muted-foreground",
    sortValue: (entry) => entry.retryCount,
    cell: (entry) => (entry.retryCount > 0 ? entry.retryCount : "—"),
  },
]

export function LogsPage() {
  const { data, isLoading, isError, error } = useLogs()
  const selection = useIdSelection()
  const { selected, size } = selection
  const [status, setStatus] = useState(NONE)
  const [viewing, setViewing] = useState<LogEntry | null>(null)

  // The status filter is the page's; the table owns the search, the paging and the selection reset
  // (`resetKey` below sends it back to page 1 and clears the selection when the filter changes).
  const rows = useMemo(() => (status === NONE ? (data ?? []) : (data ?? []).filter((entry) => entry.status === status)), [data, status])

  // "View log" only ever targets one entry — with more than one row
  // selected there's no single log to show, so it's disabled rather than
  // guessing which one to open.
  const selectedEntry = size === 1 ? ((data ?? []).find((entry) => selected.has(entry.id)) ?? null) : null
  const viewLogDisabledReason =
    size === 0
      ? "Select a log to view"
      : size > 1
        ? "Select a single log to view"
        : !selectedEntry || !hasLog(selectedEntry)
          ? "No log captured yet"
          : null

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold">Logs</h1>
        <p className="text-sm text-muted-foreground">
          yt-dlp command, exit code, and captured stdout/stderr for each download.
        </p>
      </div>

      <DataTable
        rows={rows}
        getRowId={(entry) => entry.id}
        columns={columns}
        tableId="logs"
        defaultSort={{ key: "date", dir: "desc" }}
        selection="multi"
        selectionState={selection}
        getRowLabel={(entry) => `Select ${entry.title ?? entry.url}`}
        loading={isLoading}
        error={isError ? <p className="text-sm text-destructive">Failed to load logs: {(error as Error).message}</p> : undefined}
        empty={() =>
          !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing here yet — logs for each download will show up here once one runs.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No logs match your search/filter.</p>
          )
        }
        search={{ match: matchLog, placeholder: "Search title, URL, or command…" }}
        pageSize={PAGE_SIZE}
        itemLabel={{ singular: "log", plural: "logs" }}
        resetKey={status}
        toolbar={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                disabled={viewLogDisabledReason != null}
                onClick={() => selectedEntry && setViewing(selectedEntry)}
              >
                <Eye />
                View log
              </Button>
            </TooltipTrigger>
            <TooltipContent>{viewLogDisabledReason ?? "View log"}</TooltipContent>
          </Tooltip>
        }
        filters={
          <Select value={status} onValueChange={setStatus}>
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
        }
        contextMenu={(menuRows) => [
          {
            key: "view",
            label: "View log",
            icon: <Eye />,
            disabled: menuRows.length !== 1 || !hasLog(menuRows[0]),
            onSelect: ([entry]) => setViewing(entry),
          },
        ]}
      />

      {viewing && (
        <LogDetailDialog
          entry={viewing}
          open={viewing != null}
          onOpenChange={(open) => !open && setViewing(null)}
        />
      )}
    </div>
  )
}

import { useMemo, useState } from "react"
import { ImageIcon, RotateCcw, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { DataTable } from "@/components/data-table"
import type { ColumnDef } from "@/components/data-table"
import { useIdSelection } from "@/hooks/useIdSelection"
import { useBulkDeleteHistoryItems, useBulkRetryHistoryItems, useHistory } from "@/hooks/useHistory"
import { formatDownloadStatus } from "@/lib/utils"
import type { HistoryItem } from "@/types/api"

const PAGE_SIZE = 50

// "duplicate" is deliberately excluded — it was never queued, so there's
// nothing to replay.
const RETRYABLE_STATUSES = new Set(["failed", "cancelled", "interrupted"])

const isRetryable = (h: HistoryItem) => RETRYABLE_STATUSES.has(h.status)

const STATUS_VARIANT: Record<string, "success" | "secondary" | "destructive" | "outline"> = {
  completed: "success",
  failed: "destructive",
  cancelled: "outline",
  interrupted: "destructive",
  duplicate: "secondary",
}

const matchHistory = (h: HistoryItem, q: string) => (h.title ?? h.url).toLowerCase().includes(q)

const columns: ColumnDef<HistoryItem>[] = [
  {
    key: "thumbnail",
    header: "",
    headerClassName: "w-16",
    cell: (item) => (
      <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-muted">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
          </div>
        )}
      </div>
    ),
  },
  {
    key: "title",
    header: "Title",
    sortValue: (item) => item.title ?? item.url,
    cell: (item) => (
      <>
        <p className="max-w-xs truncate font-medium">{item.title ?? item.url}</p>
        {(item.status === "failed" || item.status === "duplicate") && item.errorMessage && (
          <p
            className={`max-w-xs truncate text-xs ${item.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {item.errorMessage}
          </p>
        )}
      </>
    ),
  },
  {
    key: "status",
    header: "Status",
    type: "status",
    sortValue: (item) => formatDownloadStatus(item.status),
    cell: (item) => <Badge variant={STATUS_VARIANT[item.status] ?? "outline"}>{formatDownloadStatus(item.status)}</Badge>,
  },
  {
    key: "date",
    header: "Date",
    type: "date",
    cellClassName: "text-muted-foreground",
    sortValue: (item) => new Date(item.createdAt),
    cell: (item) => new Date(item.createdAt).toLocaleString(),
  },
]

export function HistoryPage() {
  const { data, isLoading, isError, error } = useHistory()
  const selection = useIdSelection()
  const { selected, clear, size, active } = selection
  const [deleteOpen, setDeleteOpen] = useState(false)
  const bulkDelete = useBulkDeleteHistoryItems()
  const bulkRetry = useBulkRetryHistoryItems()

  // Only the retryable ids within the current selection — Delete acts on
  // the whole selection, but Retry silently skips e.g. already-completed
  // entries rather than being disabled outright by one non-retryable pick.
  const retryableSelected = useMemo(
    () => (data ?? []).filter((h) => selected.has(h.id) && isRetryable(h)).map((h) => h.id),
    [data, selected],
  )

  const retry = (ids: number[]) => bulkRetry.mutate(ids, { onSuccess: clear })

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold">History</h1>
        <p className="text-sm text-muted-foreground">
          A permanent record of every download — unlike the Downloads page, entries here are never
          removed when a download is deleted from the queue.
        </p>
      </div>

      <DataTable
        rows={data ?? []}
        getRowId={(h) => h.id}
        columns={columns}
        tableId="history"
        defaultSort={{ key: "date", dir: "desc" }}
        selection="multi"
        selectionState={selection}
        getRowLabel={(h) => `Select ${h.title ?? h.url}`}
        loading={isLoading}
        error={isError ? <p className="text-sm text-destructive">Failed to load history: {(error as Error).message}</p> : undefined}
        empty={(query) =>
          !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing here yet — completed, failed, and cancelled downloads will show up here.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No history entries match "{query}".</p>
          )
        }
        search={{ match: matchHistory, placeholder: "Search history…" }}
        pageSize={PAGE_SIZE}
        itemLabel={{ singular: "entry", plural: "entries" }}
        toolbar={
          <>
            <Button variant="outline" size="sm" disabled={retryableSelected.length === 0} onClick={() => retry(retryableSelected)}>
              <RotateCcw className="h-4 w-4" />
              Retry
            </Button>

            <Button variant="destructive" size="sm" disabled={!active} onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {size} selected {size === 1 ? "entry" : "entries"}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes them from History. Your library files and downloads are unaffected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => bulkDelete.mutate(Array.from(selected), { onSuccess: clear })}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        }
        contextMenu={(rows) => {
          const retryable = rows.filter(isRetryable).map((h) => h.id)
          return [
            {
              key: "retry",
              label: `Retry${retryable.length > 1 ? ` (${retryable.length})` : ""}`,
              icon: <RotateCcw className="h-4 w-4" />,
              disabled: retryable.length === 0,
              onSelect: () => retry(retryable),
            },
            {
              key: "delete",
              label: `Delete${rows.length > 1 ? ` (${rows.length})` : ""}`,
              icon: <Trash2 className="h-4 w-4" />,
              destructive: true,
              disabled: rows.length === 0,
              onSelect: () => setDeleteOpen(true),
            },
          ]
        }}
      />
    </div>
  )
}

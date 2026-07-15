import { useState } from "react"
import { RotateCcw, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
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
import { useDeleteHistoryItem, useHistory, useRetryHistoryItem } from "@/hooks/useHistory"
import type { HistoryItem } from "@/types/api"

// "duplicate" is deliberately excluded — it was never queued, so there's
// nothing to replay.
const RETRYABLE_STATUSES = new Set(["failed", "cancelled", "interrupted"])

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
  interrupted: "destructive",
  duplicate: "secondary",
}

export function HistoryPage() {
  const { data, isLoading, isError, error } = useHistory()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">History</h1>
        <p className="text-sm text-muted-foreground">
          A permanent record of every download — unlike the Downloads page, entries here are never
          removed when a download is deleted from the queue.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Failed to load history: {(error as Error).message}</p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet — completed, failed, and cancelled downloads will show up here.</p>
      ) : (
        <div className="space-y-3">
          {data.map((item) => (
            <HistoryRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

function HistoryRow({ item }: { item: HistoryItem }) {
  const retry = useRetryHistoryItem()
  const deleteItem = useDeleteHistoryItem()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const retryable = RETRYABLE_STATUSES.has(item.status)

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{item.title ?? item.url}</p>
          <Badge variant={STATUS_VARIANT[item.status] ?? "outline"}>{item.status}</Badge>
        </div>
        {(item.status === "failed" || item.status === "duplicate") && item.errorMessage ? (
          <p className={`truncate text-xs ${item.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
            {item.errorMessage}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p>
        )}
      </div>

      {retryable && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => retry.mutate(item.id)}
          disabled={retry.isPending}
          title="Retry"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      )}

      <Button variant="ghost" size="icon" onClick={() => setDeleteOpen(true)} title="Delete">
        <Trash2 className="h-4 w-4" />
      </Button>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this history entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the entry from History. Your library files and downloads
              are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteItem.mutate(item.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

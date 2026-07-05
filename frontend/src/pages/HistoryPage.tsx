import { RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useHistory, useRetryHistoryItem } from "@/hooks/useHistory"
import type { HistoryItem } from "@/types/api"

const RETRYABLE_STATUSES = new Set(["failed", "cancelled", "interrupted"])

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
  interrupted: "destructive",
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
  const retryable = RETRYABLE_STATUSES.has(item.status)

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{item.title ?? item.url}</p>
          <Badge variant={STATUS_VARIANT[item.status] ?? "outline"}>{item.status}</Badge>
        </div>
        {item.status === "failed" && item.errorMessage ? (
          <p className="truncate text-xs text-destructive">{item.errorMessage}</p>
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
    </div>
  )
}

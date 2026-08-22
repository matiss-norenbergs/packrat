import { useState } from "react"
import { Download, Eye, Ghost } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAddSubscriptionEntry, useMarkSubscriptionEntrySeen, useSubscriptionEntries } from "@/hooks/useSubscriptions"
import { formatDuration } from "@/lib/utils"
import type { AddSubscriptionEntryMode, Subscription } from "@/types/api"

interface KnownItemsDialogProps {
  subscription: Subscription
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KnownItemsDialog({ subscription, open, onOpenChange }: KnownItemsDialogProps) {
  const { data: entries, isLoading } = useSubscriptionEntries(subscription.id, open)
  const addEntry = useAddSubscriptionEntry()
  const markSeen = useMarkSubscriptionEntrySeen()
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  const handleAdd = (sourceId: string, mode: AddSubscriptionEntryMode) => {
    setPendingKey(`${sourceId}:${mode}`)
    addEntry.mutate(
      { subscriptionId: subscription.id, sourceId, mode },
      { onSettled: () => setPendingKey(null) },
    )
  }

  const handleMarkSeen = (sourceId: string) => {
    setPendingKey(`${sourceId}:seen`)
    markSeen.mutate(
      { subscriptionId: subscription.id, sourceId },
      { onSettled: () => setPendingKey(null) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl min-w-0">
        <DialogHeader className="min-w-0">
          <DialogTitle className="truncate">Known items — {subscription.title}</DialogTitle>
          <DialogDescription>
            Every video Packrat has ever seen from this subscription. Add one manually as a ghost
            item or a queued download.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-md" />)
          ) : !entries || entries.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">No known items yet.</p>
          ) : (
            entries.map((entry) => {
              const isKnownEntry = entry.url !== ""
              const isUnseen = entry.seenAt == null && isKnownEntry
              const isPendingGhost = pendingKey === `${entry.sourceId}:ghost`
              const isPendingDownload = pendingKey === `${entry.sourceId}:download`
              const isPendingSeen = pendingKey === `${entry.sourceId}:seen`
              return (
                <div key={entry.sourceId} className="flex items-center gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-medium">{isKnownEntry ? entry.title : "Unknown"}</p>
                      {isUnseen && <Badge variant="secondary">New</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDuration(entry.durationSeconds)} · first seen {new Date(entry.firstSeenAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {entry.libraryItemId != null ? (
                      <Badge variant="secondary">In library</Badge>
                    ) : !isKnownEntry ? (
                      <span className="text-xs text-muted-foreground">No details recorded</span>
                    ) : (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              disabled={addEntry.isPending}
                              onClick={() => handleAdd(entry.sourceId, "ghost")}
                            >
                              <Ghost className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{isPendingGhost ? "Adding…" : "Add as ghost"}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              disabled={addEntry.isPending}
                              onClick={() => handleAdd(entry.sourceId, "download")}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{isPendingDownload ? "Queuing…" : "Queue download"}</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                    {isUnseen && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            disabled={markSeen.isPending}
                            onClick={() => handleMarkSeen(entry.sourceId)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{isPendingSeen ? "Marking…" : "Mark seen"}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

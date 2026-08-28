import { useEffect, useRef } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { fetchLibraryItem } from "@/lib/api"
import { notifyDesktop, notifyDesktopAsync, notifyEvent, notifyEventAsync } from "@/lib/notify"
import { connectDownloadsSocket } from "@/lib/ws"
import { downloadsQueryKey } from "./useDownloads"
import { libraryQueryKey } from "./useLibrary"
import {
  thumbnailEnhancementActiveItemQueryKey,
  thumbnailEnhancementEligibleQueryKey,
  thumbnailEnhancementHistoryQueryKey,
} from "./useThumbnailEnhancement"
import { frameMatchQueueQueryKey } from "./useFrameMatchQueue"
import { subscriptionsQueryKey } from "./useSubscriptions"
import { backupHistoryQueryKey } from "./useBackup"
import type { Download, ThumbnailEnhancementEligibleItem } from "@/types/api"
import type { EnhanceProgressPayload, WSEvent } from "@/types/ws"

const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 15000

// handleEnhanceProgress patches the eligible-items dialog's cached list live
// (so open dialogs update without a refetch), seeds the "currently active
// item" cache entry the AI Enhancement page reads for its live indicator,
// and invalidates the history list on a terminal event so new rows appear.
// Covers every trigger (scheduled sweep, manual, bulk-selected,
// auto-on-download) since the backend broadcasts from one shared place.
function handleEnhanceProgress(queryClient: QueryClient, payload: EnhanceProgressPayload) {
  queryClient.setQueryData<ThumbnailEnhancementEligibleItem[]>(thumbnailEnhancementEligibleQueryKey, (prev) => {
    if (!prev) return prev
    if (payload.status === "success") {
      return prev.filter((item) => item.libraryItemId !== payload.libraryItemId)
    }
    return prev.map((item) =>
      item.libraryItemId === payload.libraryItemId
        ? {
            ...item,
            isProcessing: payload.status === "processing",
            recentlyFailedAt: payload.status === "failed" ? new Date().toISOString() : item.recentlyFailedAt,
          }
        : item,
    )
  })

  queryClient.setQueryData(
    thumbnailEnhancementActiveItemQueryKey,
    payload.status === "processing" ? payload : null,
  )

  if (payload.status !== "processing") {
    queryClient.invalidateQueries({ queryKey: thumbnailEnhancementHistoryQueryKey })
  }
}

/**
 * Opens one shared WebSocket connection for the whole app and patches live
 * deltas directly into the TanStack Query cache, so download progress bars
 * update without a full refetch. REST (useDownloads/useLibrary) remains the
 * source of truth on mount/reconnect — this hook only pushes deltas.
 */
export function useDownloadsSocket() {
  const queryClient = useQueryClient()
  const attemptRef = useRef(0)

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const handleEvent = (event: WSEvent) => {
      switch (event.type) {
        case "progress": {
          const p = event.payload
          queryClient.setQueryData<Download[]>(downloadsQueryKey, (prev) =>
            prev?.map((d) =>
              d.id === p.downloadId
                ? {
                    ...d,
                    status: p.status as Download["status"],
                    percent: p.percent,
                    speedBytesPerSec: p.speedBytesPerSec,
                    etaSeconds: p.etaSeconds,
                    downloadedBytes: p.downloadedBytes,
                    totalBytes: p.totalBytes,
                  }
                : d,
            ),
          )
          break
        }
        case "completed": {
          queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
          queryClient.invalidateQueries({ queryKey: libraryQueryKey })
          const { title, libraryId } = event.payload
          // The toast shows the real title unconditionally (only ever seen
          // by whoever's already on this tab); the desktop notification
          // needs a privacy check first, since it can surface on a lock
          // screen or notification center — not somewhere a private item's
          // title should casually show up. See notifyEventAsync.
          notifyEventAsync("success", "Download complete", title, () =>
            fetchLibraryItem(libraryId).then((item) => (item.blurred ? undefined : title)),
          )
          break
        }
        case "failed": {
          queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
          const p = event.payload
          if (p.status === "cancelled") {
            notifyEvent("info", "Download cancelled", undefined, true)
          } else {
            notifyEvent("error", "Download failed", p.error, true)
          }
          break
        }
        case "queue_update": {
          queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
          break
        }
        case "enhance_progress": {
          handleEnhanceProgress(queryClient, event.payload)
          if (event.payload.status === "success") {
            const { libraryItemId, itemTitle } = event.payload
            notifyDesktopAsync("Thumbnail enhanced", () =>
              fetchLibraryItem(libraryItemId).then((item) => (item.blurred ? undefined : itemTitle)),
            )
          }
          break
        }
        case "frame_match_progress": {
          queryClient.invalidateQueries({ queryKey: frameMatchQueueQueryKey })
          if (event.payload.state === "done") {
            const { libraryItemId, itemTitle } = event.payload
            notifyDesktopAsync("Frame match found", () =>
              fetchLibraryItem(libraryItemId).then((item) => (item.blurred ? undefined : itemTitle)),
            )
          }
          break
        }
        case "subscription_new_items": {
          queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey })
          queryClient.invalidateQueries({ queryKey: libraryQueryKey })
          const { subscriptionTitle, newCount } = event.payload
          notifyDesktop(
            "New subscription items",
            `${newCount} new item${newCount === 1 ? "" : "s"} in ${subscriptionTitle}`,
          )
          break
        }
        case "backup_completed": {
          queryClient.invalidateQueries({ queryKey: backupHistoryQueryKey })
          notifyDesktop("Scheduled backup failed", event.payload.errorMessage)
          break
        }
      }
    }

    const connect = () => {
      if (stopped) return
      socket = connectDownloadsSocket(handleEvent)

      socket.addEventListener("open", () => {
        attemptRef.current = 0
        queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
        queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      })

      socket.addEventListener("close", () => {
        if (stopped) return
        const delay = Math.min(
          RECONNECT_BASE_DELAY_MS * 2 ** attemptRef.current,
          RECONNECT_MAX_DELAY_MS,
        )
        attemptRef.current += 1
        reconnectTimer = setTimeout(connect, delay)
      })
    }

    connect()

    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [queryClient])
}

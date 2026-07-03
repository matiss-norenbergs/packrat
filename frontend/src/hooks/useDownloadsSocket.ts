import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { connectDownloadsSocket } from "@/lib/ws"
import { downloadsQueryKey } from "./useDownloads"
import { libraryQueryKey } from "./useLibrary"
import type { Download } from "@/types/api"
import type { WSEvent } from "@/types/ws"

const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 15000

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
          toast.success(`Download complete: ${event.payload.title}`)
          break
        }
        case "failed": {
          queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
          const p = event.payload
          if (p.status === "cancelled") {
            toast.info("Download cancelled")
          } else {
            toast.error(`Download failed: ${p.error}`)
          }
          break
        }
        case "queue_update": {
          queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
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

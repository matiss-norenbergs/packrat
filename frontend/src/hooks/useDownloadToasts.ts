import { useEffect } from "react"
import { toast } from "sonner"
import { isTauri } from "@/lib/server"

interface Started {
  filename: string
  path: string
}

interface Finished {
  path: string | null
  success: boolean
}

// Desktop shell only. The shell saves downloads (e.g. backups) into the OS Downloads folder and
// reports them with `download-started` / `download-finished` events (src-tauri/src/downloads.rs),
// so every download gets feedback no matter which link started it. The browser keeps its own
// download UI and never loads any of this.
export function useDownloadToasts() {
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    const unlisten: Array<() => void> = []
    // Toast ids of downloads still running, oldest first. A finished event normally names the same
    // path as its started event; if it doesn't (no path on failure), it settles the oldest one.
    const inFlight: string[] = []

    void import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const started = await listen<Started>("download-started", ({ payload }) => {
          inFlight.push(payload.path)
          toast.loading(`Downloading ${payload.filename}…`, { id: payload.path, duration: Infinity })
        })
        const finished = await listen<Finished>("download-finished", ({ payload }) => {
          const at = payload.path ? inFlight.indexOf(payload.path) : -1
          const id = at >= 0 ? inFlight.splice(at, 1)[0] : (inFlight.shift() ?? payload.path ?? undefined)
          if (payload.success && payload.path) {
            const path = payload.path
            toast.success(`Saved to ${path}`, {
              id,
              duration: 10000,
              action: { label: "Show in folder", onClick: () => void revealInFolder(path) },
            })
          } else {
            toast.error("Download failed", { id, duration: 10000 })
          }
        })
        if (cancelled) {
          started()
          finished()
        } else {
          unlisten.push(started, finished)
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
      unlisten.forEach((fn) => fn())
    }
  }, [])
}

async function revealInFolder(path: string) {
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener")
    await revealItemInDir(path)
  } catch (err) {
    toast.error("Couldn't open the folder.", { description: err instanceof Error ? err.message : String(err) })
  }
}

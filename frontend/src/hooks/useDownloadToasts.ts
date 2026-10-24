import { useEffect } from "react"
import { toast } from "sonner"
import { isTauri } from "@/lib/server"

interface Started {
  filename: string
  path: string
}

interface Finished {
  path: string | null
  // The path of the matching download-started event, when the file ended up somewhere else (it was
  // fetched aside and then saved where the user chose).
  id?: string | null
  // The Save dialog was dismissed: nothing was saved, and nothing failed either.
  cancelled?: boolean
  success: boolean
}

// Desktop shell only. The shell saves downloads (e.g. backups) into the download folder — or where
// the Save dialog says, if the user asked to be asked — and reports them with `download-started` / `download-finished` events (src-tauri/src/downloads.rs),
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
          const key = payload.id ?? payload.path
          const at = key ? inFlight.indexOf(key) : -1
          const id = at >= 0 ? inFlight.splice(at, 1)[0] : (inFlight.shift() ?? key ?? undefined)
          if (payload.cancelled) {
            if (id) toast.dismiss(id)
          } else if (payload.success && payload.path) {
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

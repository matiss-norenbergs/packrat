import { useEffect, useState } from "react"
import { toast } from "sonner"

export interface DownloadFolder {
  path: string
  isDefault: boolean
}

// Desktop shell only: the folder downloads are saved to (the OS Downloads folder until one is
// chosen), kept by the shell in desktop.json. `folder` is null while loading.
export function useDownloadFolder() {
  const [folder, setFolder] = useState<DownloadFolder | null>(null)

  useEffect(() => {
    let cancelled = false
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<DownloadFolder>("get_download_folder"))
      .then((value) => !cancelled && setFolder(value))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function run(command: string) {
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const next = await invoke<DownloadFolder | null>(command)
      if (next) setFolder(next) // null: the folder picker was dismissed
    } catch (err) {
      toast.error(`Couldn't change the folder: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Opens the native folder picker.
  const choose = () => run("choose_download_folder")
  const reset = () => run("reset_download_folder")

  return { folder, choose, reset }
}

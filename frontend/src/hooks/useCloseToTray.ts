import { useEffect, useState } from "react"
import { toast } from "sonner"

// Desktop shell only. The "close to tray" preference lives in the Rust side (it has to know at the
// moment the window's close button is pressed — see desktop/src-tauri/src/prefs.rs), so it is read
// and written through Tauri commands rather than localStorage. `null` while loading.
export function useCloseToTray() {
  const [enabled, setEnabledState] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<boolean>("get_close_to_tray"))
      .then((value) => !cancelled && setEnabledState(value))
      .catch(() => !cancelled && setEnabledState(true))
    return () => {
      cancelled = true
    }
  }, [])

  async function setEnabled(next: boolean) {
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("set_close_to_tray", { enabled: next })
      setEnabledState(next)
    } catch (err) {
      toast.error(`Couldn't save the setting: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { enabled, setEnabled }
}

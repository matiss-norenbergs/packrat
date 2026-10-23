import { useEffect, useState } from "react"
import { toast } from "sonner"

// Desktop shell only. Some preferences live in the Rust side because it has to know them before
// (or without) the webview — see desktop/src-tauri/src/prefs.rs — so they are read and written
// through a pair of Tauri commands instead of localStorage. `enabled` is null while loading.
export function useShellPref(getCommand: string, setCommand: string, fallback: boolean) {
  const [enabled, setEnabledState] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<boolean>(getCommand))
      .then((value) => !cancelled && setEnabledState(value))
      .catch(() => !cancelled && setEnabledState(fallback))
    return () => {
      cancelled = true
    }
  }, [getCommand, fallback])

  async function setEnabled(next: boolean) {
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke(setCommand, { enabled: next })
      setEnabledState(next)
    } catch (err) {
      toast.error(`Couldn't save the setting: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { enabled, setEnabled }
}

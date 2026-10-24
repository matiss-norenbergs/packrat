import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

// Desktop shell only. "Launch at login" is whatever the OS says (the shell's `autostart_*` commands
// read it: ~/.config/autostart on Linux, the Run registry key on Windows, a LaunchAgent on macOS),
// never a flag of our own that could drift from it. `enabled` is null while loading or if it can't be read.
export function useAutostart() {
  const [enabled, setEnabledState] = useState<boolean | null>(null)

  const read = useCallback(async () => {
    const { invoke } = await import("@tauri-apps/api/core")
    return invoke<boolean>("autostart_is_enabled")
  }, [])

  useEffect(() => {
    let cancelled = false
    read()
      .then((value) => !cancelled && setEnabledState(value))
      .catch(() => !cancelled && setEnabledState(null))
    return () => {
      cancelled = true
    }
  }, [read])

  async function setEnabled(next: boolean) {
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("autostart_set", { enabled: next })
    } catch (err) {
      toast.error(`Couldn't change launch at login: ${err instanceof Error ? err.message : String(err)}`)
    }
    // Show what the OS ended up with, including after a failure.
    try {
      setEnabledState(await read())
    } catch {
      setEnabledState(null)
    }
  }

  return { enabled, setEnabled }
}

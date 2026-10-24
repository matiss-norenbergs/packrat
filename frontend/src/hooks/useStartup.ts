import { useAutostart } from "@/hooks/useAutostart"
import { useStartMinimized } from "@/hooks/useStartMinimized"

export type StartupMode = "off" | "shown" | "hidden"

// Desktop shell only. One choice over two stores: the OS startup entry (useAutostart) and the shell's
// `startMinimized` pref (useStartMinimized). The mode is derived from both, so it stays right when the
// OS entry is changed outside Packrat. `mode` is null while either is still loading or unreadable.
export function useStartup() {
  const { enabled: autostart, setEnabled: setAutostart } = useAutostart()
  const { enabled: startMinimized, setEnabled: setStartMinimized } = useStartMinimized()

  const mode: StartupMode | null =
    autostart === null || startMinimized === null ? null : !autostart ? "off" : startMinimized ? "hidden" : "shown"

  async function setMode(next: StartupMode) {
    // Turning it off leaves the pref alone, so re-enabling later remembers the last visibility choice.
    if (next !== "off") await setStartMinimized(next === "hidden")
    await setAutostart(next !== "off")
  }

  return { mode, setMode }
}

import { useShellPref } from "@/hooks/useShellPref"

// Desktop shell only: whether a launch from the "Launch at login" entry starts hidden in the tray
// (default off). Honored by the shell only when the tray is usable.
export function useStartMinimized() {
  return useShellPref("get_start_minimized", "set_start_minimized", false)
}

import { useShellPref } from "@/hooks/useShellPref"

// Desktop shell only: whether the window's close button hides it to the tray (default on).
export function useCloseToTray() {
  return useShellPref("get_close_to_tray", "set_close_to_tray", true)
}

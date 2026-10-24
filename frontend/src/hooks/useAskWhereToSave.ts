import { useShellPref } from "@/hooks/useShellPref"

// Desktop shell only: whether every download opens a native Save dialog instead of going straight
// to the download folder (default off). Read by the shell's download handler.
export function useAskWhereToSave() {
  return useShellPref("get_ask_where_to_save", "set_ask_where_to_save", false)
}

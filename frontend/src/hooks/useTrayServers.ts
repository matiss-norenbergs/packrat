import { useEffect } from "react"
import { getActiveProfile, getProfiles, isTauri, subscribeProfiles } from "@/lib/server"
import { openProfile } from "@/lib/serverSwitch"

// Desktop shell only. The saved servers live in localStorage, which the shell can't read, so the
// list is pushed to the tray menu (`tray_set_servers`) on mount and whenever it or the active
// server changes. Picking a server in the tray comes back as a `tray-switch-server` event and
// switches exactly like the sidebar switcher does. A no-op on the web.
export function useTrayServers() {
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unlisten: (() => void) | undefined

    const push = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        await invoke("tray_set_servers", {
          servers: getProfiles().map(({ id, name }) => ({ id, name })),
          activeId: getActiveProfile()?.id ?? null,
        })
      } catch {
        // no tray, or not the shell — nothing to keep in sync
      }
    }

    void push()
    const unsubscribe = subscribeProfiles(() => void push())

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>("tray-switch-server", (event) => {
          const id = event.payload
          if (typeof id !== "string" || !getProfiles().some((p) => p.id === id)) return
          openProfile(id)
        }),
      )
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })
      .catch(() => {})

    return () => {
      cancelled = true
      unsubscribe()
      unlisten?.()
    }
  }, [])
}

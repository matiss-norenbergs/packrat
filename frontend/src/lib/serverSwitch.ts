import { reloadApp, setAddingServer, switchProfile } from "@/lib/server"

// Desktop only. Switching sets the active profile and reloads, so the router, auth check and every
// query start fresh against that server — signed in with that profile's own token, if it has one.
export function openProfile(id: string) {
  setAddingServer(false)
  switchProfile(id)
  reloadApp()
}

// "Add server…" shows the connect screen (the current server stays until a new one is saved).
export function startAddingServer() {
  setAddingServer(true)
  reloadApp()
}

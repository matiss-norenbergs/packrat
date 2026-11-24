import { isTauriMobile } from "@/lib/server"

// The Android app is "Browse-only": the same frontend, but only the Browse pages (home, show,
// artist, item player) and the sign-in screen are reachable; the management area — Dashboard,
// Library, Downloads, Settings and the rest — is not part of the app. Everything app-specific is
// gated on this one check, so the web UI and the desktop app are unchanged. See "Android app mode"
// in docs/architecture.md.
export function isBrowseOnlyApp(): boolean {
  return isTauriMobile()
}

import { useSyncExternalStore } from "react"
import { useSettings } from "@/hooks/useSettings"
import { isBrowseOnlyApp } from "@/lib/appMode"

// The Browse area's playback/privacy preferences. Everywhere they follow the server's settings
// (`libraryAutoplay`, and `browseIgnorePrivacy` inverted into "blur private items"). In the Android
// app (Browse-only mode) each can also be overridden on this device from Browse → Settings: the
// override is a localStorage value that is unset by default ("follow the server") and is never
// written to the server. Outside the app the overrides are ignored, so the web UI and the desktop
// app read the server settings exactly as before. See docs/architecture.md → "Android app mode".

export const BROWSE_AUTOPLAY_KEY = "packrat:browse-autoplay"
export const BROWSE_BLUR_PRIVATE_KEY = "packrat:browse-blur-private"
// Same-tab change notice; the storage event only fires in other tabs/windows.
const CHANGE_EVENT = "packrat:browse-prefs-changed"

// Used only when localStorage itself is unusable, so a toggle still applies for this session.
const memory = new Map<string, string>()

function readOverride(key: string): boolean | null {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    raw = memory.get(key) ?? null
  }
  return raw === "true" ? true : raw === "false" ? false : null
}

function writeOverride(key: string, value: boolean | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, String(value))
  } catch {
    if (value === null) memory.delete(key)
    else memory.set(key, String(value))
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}

function useOverride(key: string, active: boolean): boolean | null {
  return useSyncExternalStore(subscribe, () => (active ? readOverride(key) : null))
}

export function useBrowsePrefs() {
  const { data: settings } = useSettings()
  const app = isBrowseOnlyApp()
  const autoplayOverride = useOverride(BROWSE_AUTOPLAY_KEY, app)
  const blurOverride = useOverride(BROWSE_BLUR_PRIVATE_KEY, app)

  // The same fallbacks the Browse code used while settings load.
  const serverAutoplay = settings?.libraryAutoplay ?? true
  const serverBlurPrivate = !(settings?.browseIgnorePrivacy ?? false)

  return {
    autoplay: autoplayOverride ?? serverAutoplay,
    blurPrivate: blurOverride ?? serverBlurPrivate,
    serverAutoplay,
    serverBlurPrivate,
    autoplayOverridden: autoplayOverride !== null,
    blurPrivateOverridden: blurOverride !== null,
    setAutoplay: (value: boolean) => writeOverride(BROWSE_AUTOPLAY_KEY, value),
    setBlurPrivate: (value: boolean) => writeOverride(BROWSE_BLUR_PRIVATE_KEY, value),
    resetAutoplay: () => writeOverride(BROWSE_AUTOPLAY_KEY, null),
    resetBlurPrivate: () => writeOverride(BROWSE_BLUR_PRIVATE_KEY, null),
  }
}

import { useEffect, useSyncExternalStore } from "react"
import { isAccentConfirmed, subscribeAccent } from "@/hooks/useAccentColor"
import { isTauriDesktop } from "@/lib/server"

const DEBOUNCE_MS = 150

// Desktop shell only. Pushes the Packrat logo in the current primary color to the window and tray
// icons (`set_app_icon`), so the active server can be told apart by its icon. Waits until the
// accent is the account's real one (not the localStorage cache), then re-sends when the accent or
// the theme changes (both land as attributes on <html>); a burst is debounced and an unchanged
// color is not re-sent. A server switch reloads the app, which starts this over with the new
// server's account. A no-op on the web and on Android (no window/tray icon to set), and the
// renderer and the Tauri API are imported only once there is something to send.
export function useDesktopIcon() {
  const confirmed = useSyncExternalStore(subscribeAccent, isAccentConfirmed)

  useEffect(() => {
    if (!isTauriDesktop() || !confirmed) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let sent: string | null = null

    const push = async () => {
      try {
        const [{ readLogoColors, renderLogoPng }, { invoke }] = await Promise.all([
          import("@/lib/appIcon"),
          import("@tauri-apps/api/core"),
        ])
        const colors = readLogoColors()
        if (!colors) return
        const key = `${colors.from}|${colors.to}|${colors.glyph}`
        if (key === sent) return
        const png = await renderLogoPng(colors)
        if (cancelled) return
        await invoke("set_app_icon", { png })
        sent = key
      } catch {
        // no canvas, no tray, or not the shell — the bundled icon stays
      }
    }
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void push(), DEBOUNCE_MS)
    }

    schedule()
    const observer = new MutationObserver(schedule)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-accent"] })
    return () => {
      cancelled = true
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [confirmed])
}

import { useEffect, useRef, useSyncExternalStore } from "react"
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
  // The color last sent successfully; starts clean on every effect run, like the observer does.
  const sent = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!isTauriDesktop() || !confirmed) return
    const stop = new AbortController()
    sent.current = null

    const push = async () => {
      try {
        const [{ readLogoColors, renderLogoPng }, { invoke }] = await Promise.all([
          import("@/lib/appIcon"),
          import("@tauri-apps/api/core"),
        ])
        const colors = readLogoColors()
        if (!colors) return
        const key = `${colors.from}|${colors.to}|${colors.glyph}`
        if (key === sent.current) return
        const png = await renderLogoPng(colors)
        if (stop.signal.aborted) return
        await invoke("set_app_icon", { png })
        sent.current = key
      } catch {
        // no canvas, no tray, or not the shell — the bundled icon stays
      }
    }
    const schedule = () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void push(), DEBOUNCE_MS)
    }

    schedule()
    const observer = new MutationObserver(schedule)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-accent"] })
    return () => {
      stop.abort()
      clearTimeout(timer.current)
      observer.disconnect()
    }
  }, [confirmed])
}

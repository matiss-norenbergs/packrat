import { useEffect, type RefObject } from "react"
import { isTauriMobile } from "@/lib/server"

// The Android shell's one native hook for the page (MainActivity.kt, `onWebViewCreate`): Android's
// WebView doesn't hide the status and navigation bars when a page goes fullscreen — the host app
// has to — so the shell injects `window.PackratAndroid.setImmersive(enabled)`, which hides them
// (they come back briefly on a swipe from the edge) and drops the content's system-bar padding, or
// restores both. It exists only in the Android app; everywhere else this is a no-op.
export interface ImmersiveBridge {
  setImmersive(enabled: boolean): void
}

export function androidImmersiveBridge(): ImmersiveBridge | null {
  if (!isTauriMobile()) return null
  const bridge = (window as unknown as { PackratAndroid?: Partial<ImmersiveBridge> }).PackratAndroid
  return bridge && typeof bridge.setImmersive === "function" ? (bridge as ImmersiveBridge) : null
}

// Keeps the system bars in step with the player's own fullscreen: hidden while `frameRef`'s element
// is the fullscreen element, shown again when fullscreen ends, when the app goes to the background
// (fullscreen is left too, so the page and the bars agree on return) and when the player unmounts
// (navigating away from the item page).
export function useAndroidImmersive(frameRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const bridge = androidImmersiveBridge()
    // The frame as mounted: by the time the cleanup runs on unmount React has already cleared the ref.
    const frame = frameRef.current
    if (!bridge || !frame) return
    const current = { immersive: false } // what the bridge was last told
    const set = (enabled: boolean) => {
      if (enabled === current.immersive) return
      current.immersive = enabled
      try {
        bridge.setImmersive(enabled)
      } catch {
        // a failing bridge must never break the player
      }
    }
    const leaveFullscreen = () => {
      if (document.fullscreenElement === frame) void document.exitFullscreen?.()?.catch(() => {})
    }
    const onFullscreenChange = () => set(document.fullscreenElement === frame)
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden" || !current.immersive) return
      set(false)
      leaveFullscreen()
    }
    document.addEventListener("fullscreenchange", onFullscreenChange)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange)
      document.removeEventListener("visibilitychange", onVisibilityChange)
      if (current.immersive) {
        set(false)
        leaveFullscreen()
      }
    }
  }, [frameRef])
}

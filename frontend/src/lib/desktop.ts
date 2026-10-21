import { isTauri } from "@/lib/server"

// Desktop shell only. The webview can't open a new window for a target=_blank link, and following
// an off-app http(s) link would navigate the app itself away — so those open in the system browser
// via Tauri's opener plugin. Links with a `download` attribute are left alone: they trigger a file
// download (e.g. a backup), which the shell handles itself.
export function installExternalLinkHandler() {
  if (!isTauri()) return
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0) return
    const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
    if (!anchor || anchor.hasAttribute("download")) return
    let url: URL
    try {
      url = new URL(anchor.href)
    } catch {
      return
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return
    if (anchor.target !== "_blank" && url.origin === window.location.origin) return
    e.preventDefault()
    void import("@tauri-apps/plugin-opener").then((plugin) => plugin.openUrl(url.href)).catch(() => {})
  })
}

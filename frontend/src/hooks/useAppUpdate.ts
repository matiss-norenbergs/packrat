import { useRef, useState } from "react"
import type { Update } from "@tauri-apps/plugin-updater"

// Desktop shell only. A manual "check for updates": nothing is contacted until check() is called
// (from the Settings → Desktop button), and nothing is downloaded until install() is called. The
// plugin verifies the download's signature against the public key built into the app before it
// installs anything. The plugins are imported lazily so the web bundle never loads them.
export type AppUpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "upToDate" }
  | { status: "available"; version: string; notes: string | null }
  | { status: "installing"; downloaded: number; total: number | null }
  | { status: "error"; during: "check" | "install"; message: string }

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>({ status: "idle" })
  const update = useRef<Update | null>(null)

  async function check() {
    setState({ status: "checking" })
    try {
      const { check } = await import("@tauri-apps/plugin-updater")
      const found = await check()
      update.current = found
      setState(found ? { status: "available", version: found.version, notes: found.body ?? null } : { status: "upToDate" })
    } catch (err) {
      setState({ status: "error", during: "check", message: describe(err) })
    }
  }

  async function install() {
    const pending = update.current
    if (!pending) return
    let downloaded = 0
    let total: number | null = null
    setState({ status: "installing", downloaded, total })
    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? null
        else if (event.event === "Progress") downloaded += event.data.chunkLength
        setState({ status: "installing", downloaded, total })
      })
      // Windows quits on its own while the installer runs; elsewhere the new version starts here.
      const { relaunch } = await import("@tauri-apps/plugin-process")
      await relaunch()
    } catch (err) {
      setState({ status: "error", during: "install", message: describe(err) })
    }
  }

  return { state, check, install }
}

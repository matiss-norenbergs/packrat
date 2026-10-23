import { useState } from "react"
import { compareSemver, isReleaseVersion } from "@/lib/semver"

// Desktop shell only. "Match server version": install the app release equal to the server's,
// whether that's an upgrade or a downgrade. The work happens in the Rust side
// (desktop/src-tauri/src/match_update.rs) because the JS updater can't change its endpoint; it
// validates the version, builds the release URL and verifies the signature. Nothing is contacted
// until check() and nothing is installed until install() (after the user confirms).
export type MatchServerState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "matches" }
  | { status: "confirm"; version: string; currentVersion: string; downgrade: boolean }
  | { status: "installing"; downloaded: number; total: number | null }
  | { status: "error"; during: "check" | "install"; message: string }

interface Found {
  version: string
  currentVersion: string
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useMatchServerVersion() {
  const [state, setState] = useState<MatchServerState>({ status: "idle" })

  async function check(serverVersion: string | null | undefined) {
    if (!isReleaseVersion(serverVersion)) return
    setState({ status: "checking" })
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const found = await invoke<Found | null>("match_update_check", { version: serverVersion })
      setState(
        found
          ? {
              status: "confirm",
              version: found.version,
              currentVersion: found.currentVersion,
              downgrade: compareSemver(found.version, found.currentVersion) === -1,
            }
          : { status: "matches" },
      )
    } catch (err) {
      setState({ status: "error", during: "check", message: describe(err) })
    }
  }

  async function install() {
    let downloaded = 0
    let total: number | null = null
    setState({ status: "installing", downloaded, total })
    let unlisten: (() => void) | undefined
    try {
      const [{ invoke }, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")])
      unlisten = await listen<{ downloaded: number; total: number | null }>("match-update-progress", (event) => {
        downloaded = event.payload.downloaded
        total = event.payload.total ?? null
        setState({ status: "installing", downloaded, total })
      })
      await invoke("match_update_install")
      // Windows quits on its own while the installer runs; elsewhere the new version starts here.
      const { relaunch } = await import("@tauri-apps/plugin-process")
      await relaunch()
    } catch (err) {
      setState({ status: "error", during: "install", message: describe(err) })
    } finally {
      unlisten?.()
    }
  }

  function cancel() {
    setState({ status: "idle" })
  }

  return { state, check, install, cancel }
}

import { useEffect, useState } from "react"
import { useAppVersion } from "@/hooks/useSettings"
import { appNewerThanServer, serverNewerThanApp } from "@/lib/semver"
import { isTauri } from "@/lib/server"

export type VersionMismatchKind = "server-newer" | "app-newer"

// "server-newer" keeps the key it always had, so an existing dismissal still counts.
const DISMISSED_KEYS: Record<VersionMismatchKind, string> = {
  "server-newer": "packrat.dismissedServerNewer",
  "app-newer": "packrat.dismissedAppNewer",
}

function pairKey(server: string, app: string) {
  return `${server}|${app}`
}

function readDismissed(kind: VersionMismatchKind): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEYS[kind])
  } catch {
    return null
  }
}

// Desktop shell only; call once signed in (it fetches /api/version). Returns the versions to
// mention when the server and the app are different releases, until the user dismisses that exact
// (kind, server, app) combination — a further server upgrade or an app update brings the notice
// back. Non-release versions (e.g. a "dev" server) and equal versions never produce one.
export function useVersionMismatchNotice() {
  const { data } = useAppVersion()
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Record<VersionMismatchKind, string | null>>(() => ({
    "server-newer": readDismissed("server-newer"),
    "app-newer": readDismissed("app-newer"),
  }))

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((v) => !cancelled && setAppVersion(v))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const server = data?.version
  if (!server || !appVersion) return { notice: null, dismiss: () => {} }
  const kind: VersionMismatchKind | null = serverNewerThanApp(server, appVersion)
    ? "server-newer"
    : appNewerThanServer(server, appVersion)
      ? "app-newer"
      : null
  if (!kind) return { notice: null, dismiss: () => {} }

  const key = pairKey(server, appVersion)
  return {
    notice: dismissed[kind] === key ? null : { kind, server, app: appVersion },
    dismiss: () => {
      try {
        window.localStorage.setItem(DISMISSED_KEYS[kind], key)
      } catch {
        // storage unavailable — it just reappears next launch
      }
      setDismissed((d) => ({ ...d, [kind]: key }))
    },
  }
}

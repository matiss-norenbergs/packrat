import { useEffect, useState } from "react"
import { useAppVersion } from "@/hooks/useSettings"
import { serverNewerThanApp } from "@/lib/semver"
import { isTauri } from "@/lib/server"

const DISMISSED_KEY = "packrat.dismissedServerNewer"

function pairKey(server: string, app: string) {
  return `${server}|${app}`
}

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

// Desktop shell only; call once signed in (it fetches /api/version). Returns the versions to
// mention when the server is a newer release than this app, until the user dismisses that exact
// (server, app) pair — a further server upgrade or an app update brings the notice back.
export function useServerNewerNotice() {
  const { data } = useAppVersion()
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(readDismissed)

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
  if (!server || !appVersion || !serverNewerThanApp(server, appVersion)) return { notice: null, dismiss: () => {} }
  const key = pairKey(server, appVersion)
  return {
    notice: dismissed === key ? null : { server, app: appVersion },
    dismiss: () => {
      try {
        window.localStorage.setItem(DISMISSED_KEY, key)
      } catch {
        // storage unavailable — it just reappears next launch
      }
      setDismissed(key)
    },
  }
}

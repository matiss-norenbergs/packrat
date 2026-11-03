import { useEffect, useState } from "react"

// The desktop app's own version (Tauri's getVersion()), or null while it loads
// or if it can't be read. Imported dynamically so the web build never pulls in Tauri.
export function useDesktopAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((v) => !cancelled && setVersion(v))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return version
}

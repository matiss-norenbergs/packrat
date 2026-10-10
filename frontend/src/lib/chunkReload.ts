// Recovery from stale route chunks after a deploy.
//
// A tab opened before an update still references the old hashed chunk names.
// Importing a page it hasn't loaded yet requests a file that no longer exists,
// the SPA fallback answers 200 text/html and the dynamic import rejects.
// Reloading once picks up the new index.html (and chunk names) at the same
// URL. A sessionStorage timestamp makes sure a genuinely broken deploy shows
// an error instead of reloading forever.

const STORAGE_KEY = "packrat:chunk-reload-at"
export const CHUNK_RELOAD_WINDOW_MS = 30_000

// Chrome / Firefox / Safari wording for a failed dynamic import or module
// script (Vite's own CSS preload failure is included).
const CHUNK_ERROR_PATTERN =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to load module script|unable to preload css/i

export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : ""
  return CHUNK_ERROR_PATTERN.test(message)
}

interface ReloadDeps {
  now?: () => number
  storage?: Pick<Storage, "getItem" | "setItem">
  reload?: () => void
}

function defaultStorage(): ReloadDeps["storage"] {
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

// Reloads the page unless it already did within CHUNK_RELOAD_WINDOW_MS.
// Returns true when a reload was triggered. If sessionStorage can't be used the
// guard can't be trusted, so it refuses to reload rather than risk a loop.
export function reloadForStaleChunk(deps: ReloadDeps = {}): boolean {
  const now = (deps.now ?? Date.now)()
  const storage = deps.storage ?? defaultStorage()
  const reload = deps.reload ?? (() => window.location.reload())
  if (!storage) return false
  try {
    const last = Number(storage.getItem(STORAGE_KEY))
    if (Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_WINDOW_MS) return false
    storage.setItem(STORAGE_KEY, String(now))
  } catch {
    return false
  }
  reload()
  return true
}

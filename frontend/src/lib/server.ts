// Where the app talks to. In the browser (the Docker-served web UI) the page and the API share an
// origin, so every URL stays relative and auth is the session cookie. In the desktop app (Tauri)
// the page is served from the app bundle and the user points it at a Packrat server, so URLs are
// prefixed with that server's address and auth is a bearer token (see backend/internal/api/
// auth_middleware.go). The desktop app keeps a list of servers ("profiles", lib/serverProfiles.ts)
// with one active at a time and a login token per profile. Everything here is a no-op on the web.

import {
  activateProfile,
  addProfile,
  deactivateProfile,
  deleteProfile,
  getActiveProfile,
  getActiveProfileId,
  getProfiles,
  isAddingServer,
  LEGACY_TOKEN_PROFILE_KEY,
  localTokenKey,
  read,
  updateProfile,
  write,
} from "@/lib/serverProfiles"

export {
  deriveProfileName,
  getActiveProfile,
  getLastServerUrl,
  getProfiles,
  isAddingServer,
  setAddingServer,
  subscribeProfiles,
  type ServerProfile,
} from "@/lib/serverProfiles"

// Fired when the server rejects the desktop client's token, so the app can fall back to the login
// screen (see App.tsx).
export const UNAUTHORIZED_EVENT = "packrat:unauthorized"

// True only inside the real Tauri shell — where its plugins (notifications, opening links in the
// system browser) exist. isDesktop() is also true under VITE_DESKTOP, which has no plugins.
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

// True inside the Tauri shell. VITE_DESKTOP=true forces it for a plain browser, so the desktop
// code path can be exercised against a dev server without building the shell.
export function isDesktop(): boolean {
  if (import.meta.env.VITE_DESKTOP === "true") return true
  return isTauri()
}

// Accepts what a person types ("192.168.1.5:50505", "https://packrat.example/") and returns a clean
// base URL with no trailing slash, or null if it isn't a usable http(s) address. A bare host
// defaults to http:// because plain HTTP on a LAN is the usual self-hosted setup.
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

// Switching or (re)connecting a server restarts the page so the router, auth check and every query
// start fresh against it. A function of its own so tests can stand in for it.
export function reloadApp() {
  window.location.reload()
}

// The address of the active server profile. Desktop only.
export function getServerUrl(): string | null {
  return getActiveProfile()?.url ?? null
}

export function getActiveProfileName(): string | null {
  return getActiveProfile()?.name ?? null
}

// Makes `url` the active server — reusing the profile that already has this address, else adding
// one — without touching any token: each profile keeps its own login. The app reloads afterwards.
export function setServerUrl(url: string, name?: string) {
  activateProfile(addProfile(url, name).id)
}

// Switching profiles: callers reload afterwards and the app comes back signed in with that
// profile's own token. Nothing is cleared.
export function switchProfile(id: string) {
  activateProfile(id)
}

export function renameProfile(id: string, name: string) {
  const trimmed = name.trim()
  if (trimmed) updateProfile(id, { name: trimmed })
}

// Saves a new address for a profile. The old address's login isn't valid for whatever answers at
// the new one (and must never be sent there), so the local copy is dropped and the OLD server is
// asked to end that session (best effort, see signOutOnServer).
export async function changeProfileUrl(id: string, url: string): Promise<void> {
  const old = getProfiles().find((p) => p.id === id)
  const token = old ? await readProfileToken(id) : null
  updateProfile(id, { url })
  await clearProfileToken(id)
  if (old && token) await signOutOnServer(old.url, token)
}

// Forgets a server and its login, and asks that server to end the session (best effort).
// Removing the active profile leaves the app without a server, so it shows the connect screen.
// The login is gone locally before the request goes out; this resolves once the request has
// settled (a few seconds at most).
export async function removeProfile(id: string): Promise<void> {
  const old = getProfiles().find((p) => p.id === id)
  const token = old ? await readProfileToken(id) : null
  deleteProfile(id)
  await clearProfileToken(id)
  if (old && token) await signOutOnServer(old.url, token)
}

const SIGN_OUT_TIMEOUT_MS = 3000

// Ends `token`'s session on the server at `url` so it doesn't linger in Settings → Account →
// Sessions until it expires. Never throws and gives up after a few seconds: an unreachable or
// slow server must not hold up forgetting it. Sent with the profile's own token, to its own address.
async function signOutOnServer(url: string, token: string): Promise<void> {
  try {
    await fetch(`${url}/api/auth/logout`, {
      method: "POST",
      credentials: "omit",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SIGN_OUT_TIMEOUT_MS),
    })
  } catch {
    // unreachable, timed out or blocked: the local login is dropped regardless
  }
}

// Leave the active server (profiles and their logins stay) — the connect screen shows next.
export function resetServer() {
  deactivateProfile()
}

// Where the login token lives. In the Tauri shell it goes to the OS keychain (Windows Credential
// Manager, macOS Keychain, Linux Secret Service), one entry per profile id, so it isn't a plain
// file in the app's data directory; getToken() stays synchronous by reading an in-memory copy of
// the active profile's token that initTokenStore() fills before the first render. If the keychain
// is unavailable, or the browser/VITE_DESKTOP path is in use, it stays in localStorage
// (packrat.token.<id>) — a login is never dropped silently.
export type TokenStorage = "keychain" | "local"

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

let tokenStorage: TokenStorage = "local"
let tokenCache: string | null = null
// Which profile tokenCache belongs to; a cache for another profile is never served.
let tokenCacheFor: string | null = null
let invokeShell: Invoke | null = null

// Settles once the token is loaded (immediately on the web). Anything that fires an authenticated
// request at module load — the auth prefetch in routes/index.tsx — has to wait for it.
let markTokenReady: () => void = () => {}
export const tokenReady: Promise<void> = isTauri()
  ? new Promise<void>((resolve) => {
      markTokenReady = resolve
    })
  : Promise.resolve()

export function getTokenStorage(): TokenStorage {
  return tokenStorage
}

// Tauri only; awaited in main.tsx before rendering. Moves a pre-keychain localStorage token into the
// keychain (existing logins survive the upgrade) and loads the active profile's token into memory.
export async function initTokenStore(): Promise<void> {
  if (isDesktop()) {
    // The app start counts as using the active server (Settings → Servers → Last used).
    const active = getActiveProfileId()
    if (active) activateProfile(active)
  }
  if (!isTauri()) return
  try {
    await loadToken()
  } finally {
    markTokenReady()
  }
}

async function loadToken() {
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    if ((await invoke<TokenStorage>("token_store_kind")) !== "keychain") return
    // From before profiles: the single keychain entry belongs to the first profile. A failure
    // keeps the flag, so the next start retries.
    const legacyId = read(LEGACY_TOKEN_PROFILE_KEY)
    if (legacyId) {
      try {
        await invoke("token_adopt_legacy", { id: legacyId })
        write(LEGACY_TOKEN_PROFILE_KEY, null)
      } catch {
        // retried next start
      }
    }
    const id = getActiveProfileId()
    let token: string | null = null
    if (id) {
      token = await invoke<string | null>("token_get", { id })
      const local = read(localTokenKey(id))
      if (local) {
        if (!token) {
          await invoke("token_set", { id, token: local })
          token = local
        }
        write(localTokenKey(id), null)
      }
    }
    invokeShell = invoke as Invoke
    tokenCache = token
    tokenCacheFor = id
    tokenStorage = "keychain"
  } catch {
    // keychain unusable — keep using localStorage
  }
}

// The keychain stopped answering mid-session: keep the login in localStorage instead of losing it.
function fallBackToLocal() {
  tokenStorage = "local"
  if (tokenCacheFor && tokenCache) write(localTokenKey(tokenCacheFor), tokenCache)
}

export function getToken(): string | null {
  const id = getActiveProfileId()
  if (!id) return null
  if (tokenStorage !== "keychain") return read(localTokenKey(id))
  return tokenCacheFor === id ? tokenCache : null
}

export function setToken(token: string) {
  const id = getActiveProfileId()
  if (!id) return
  if (tokenStorage !== "keychain") return write(localTokenKey(id), token)
  tokenCache = token
  tokenCacheFor = id
  invokeShell?.("token_set", { id, token }).catch(fallBackToLocal)
}

export function clearToken() {
  const id = getActiveProfileId()
  if (id) void clearProfileToken(id)
}

// One profile's login, whether or not it is the active one.
async function readProfileToken(id: string): Promise<string | null> {
  const local = read(localTokenKey(id))
  if (tokenStorage !== "keychain") return local
  if (tokenCacheFor === id) return tokenCache
  try {
    return (await invokeShell?.<string | null>("token_get", { id })) ?? local
  } catch {
    return local
  }
}

// Drops one profile's login wherever it is kept. Never rejects: a keychain that can't answer has
// nothing we could delete anyway.
async function clearProfileToken(id: string): Promise<void> {
  write(localTokenKey(id), null)
  if (tokenCacheFor === id) {
    tokenCache = null
    tokenCacheFor = null
  }
  if (tokenStorage === "keychain") {
    try {
      await invokeShell?.("token_clear", { id })
    } catch {
      // see above
    }
  }
}

// The desktop app has no server to talk to until the user has entered one.
export function needsServerUrl(): boolean {
  return isDesktop() && !getServerUrl()
}

// The connect screen replaces the app: no server yet, or "Add server…" was chosen.
export function showsConnectScreen(): boolean {
  return needsServerUrl() || (isDesktop() && isAddingServer())
}

// Prefix for fetch URLs: "" on the web (same origin), the server address on desktop.
export function apiBase(): string {
  return isDesktop() ? (getServerUrl() ?? "") : ""
}

// A server-relative path (e.g. "/media-files/a.mp4") as a URL the browser can load directly. On
// desktop it gets the server prefix and ?token= — <img>/<video>/<a> requests can't send an
// Authorization header, and the backend accepts the query form for GET/HEAD. Unchanged on the web.
export function serverUrl(path: string): string {
  if (!isDesktop()) return path
  const url = `${getServerUrl() ?? ""}${path}`
  const token = getToken()
  if (!token) return url
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
}

// The /ws endpoint, ws(s):// on desktop (from the server address), same-origin on the web.
export function websocketUrl(): string {
  if (!isDesktop()) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    return `${protocol}//${window.location.host}/ws`
  }
  const base = (getServerUrl() ?? "").replace(/^http/i, "ws")
  const token = getToken()
  return `${base}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`
}

export type ProbeResult = { ok: true } | { ok: false; message: string }

// Checks that `url` is a reachable Packrat server before the app commits to it.
export async function probeServer(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(`${url}/api/health`, { credentials: "omit", signal: AbortSignal.timeout(8000) })
    if (!res.ok) return { ok: false, message: `The server answered ${res.status}. Is this a Packrat server?` }
    const body = (await res.json().catch(() => null)) as { status?: string } | null
    if (body?.status !== "ok") return { ok: false, message: "That address doesn't look like a Packrat server." }
    return { ok: true }
  } catch {
    return {
      ok: false,
      message:
        "Couldn't reach the server. Check the address, and that the server allows this app's origin (CORS_ALLOWED_ORIGINS).",
    }
  }
}

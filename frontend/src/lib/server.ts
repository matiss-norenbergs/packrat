// Where the app talks to. In the browser (the Docker-served web UI) the page and the API share an
// origin, so every URL stays relative and auth is the session cookie. In the desktop app (Tauri)
// the page is served from the app bundle and the user points it at a Packrat server, so URLs are
// prefixed with that server's address and auth is a bearer token (see backend/internal/api/
// auth_middleware.go). Everything here is a no-op on the web.

const SERVER_URL_KEY = "packrat.serverUrl"
const LAST_SERVER_URL_KEY = "packrat.lastServerUrl"
const TOKEN_KEY = "packrat.token"

// Fired when the server rejects the desktop client's token, so the app can fall back to the login
// screen (see App.tsx).
export const UNAUTHORIZED_EVENT = "packrat:unauthorized"

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // storage unavailable — the app just won't remember the server/login across restarts
  }
}

// True inside the Tauri shell. VITE_DESKTOP=true forces it for a plain browser, so the desktop
// code path can be exercised against a dev server without building the shell.
export function isDesktop(): boolean {
  if (import.meta.env.VITE_DESKTOP === "true") return true
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
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

export function getServerUrl(): string | null {
  return read(SERVER_URL_KEY)
}

// Switching servers drops the old server's token — it isn't valid anywhere else.
export function setServerUrl(url: string) {
  if (getServerUrl() !== url) clearToken()
  write(SERVER_URL_KEY, url)
  write(LAST_SERVER_URL_KEY, url)
}

// "Change server": forgets the server and token, but remembers the address to prefill the form.
export function resetServer() {
  clearToken()
  write(SERVER_URL_KEY, null)
}

export function getLastServerUrl(): string {
  return read(LAST_SERVER_URL_KEY) ?? ""
}

export function getToken(): string | null {
  return read(TOKEN_KEY)
}

export function setToken(token: string) {
  write(TOKEN_KEY, token)
}

export function clearToken() {
  write(TOKEN_KEY, null)
}

// The desktop app has no server to talk to until the user has entered one.
export function needsServerUrl(): boolean {
  return isDesktop() && !getServerUrl()
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

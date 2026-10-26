// Desktop only: the list of Packrat servers the app knows, kept in localStorage next to the old
// single-server keys it replaces. A profile is only {id, name, url, lastUsedAt} — never a token;
// each profile's login token is stored separately, keyed by its id (see server.ts). Nothing here
// touches the keychain.

export interface ServerProfile {
  id: string
  name: string
  url: string
  /** Epoch milliseconds of the last time this server was connected to. */
  lastUsedAt: number
}

const PROFILES_KEY = "packrat.profiles"
const ACTIVE_KEY = "packrat.activeProfile"
const LAST_SERVER_URL_KEY = "packrat.lastServerUrl"
const ADDING_KEY = "packrat.addingServer"

// Keys of the single-server era; getProfiles() folds them into the first profile.
const LEGACY_URL_KEY = "packrat.serverUrl"
const LEGACY_TOKEN_KEY = "packrat.token"
// Set when a legacy keychain entry still has to move to a profile's own keychain account
// (the shell does it at startup, see loadToken in server.ts).
export const LEGACY_TOKEN_PROFILE_KEY = "packrat.legacyTokenProfile"

export function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // storage unavailable — the app just won't remember the servers/login across restarts
  }
}

/** localStorage key of a profile's token when it isn't in the keychain. */
export function localTokenKey(id: string): string {
  return `${LEGACY_TOKEN_KEY}.${id}`
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

function isProfile(value: unknown): value is ServerProfile {
  if (typeof value !== "object" || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.id === "string" &&
    p.id !== "" &&
    typeof p.name === "string" &&
    typeof p.url === "string" &&
    typeof p.lastUsedAt === "number"
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The host of `url`, made unique among `taken` names ("nas:50505", "nas:50505 (2)"). */
export function deriveProfileName(url: string, taken: readonly string[] = []): string {
  const base = hostOf(url)
  if (!taken.includes(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`
    if (!taken.includes(candidate)) return candidate
  }
}

const CHANGED_EVENT = "packrat:profiles-changed"

function save(profiles: ServerProfile[]) {
  write(PROFILES_KEY, JSON.stringify(profiles))
  window.dispatchEvent(new Event(CHANGED_EVENT))
}

/** For useSyncExternalStore: calls `onChange` whenever a profile is added, renamed, changed or removed. */
export function subscribeProfiles(onChange: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, onChange)
  return () => window.removeEventListener(CHANGED_EVENT, onChange)
}

// A pre-profiles install has one server address and (maybe) one token: they become the first
// profile, named after its host and still logged in. Runs once — the profiles key then exists.
function migrateLegacy(): ServerProfile[] {
  const url = read(LEGACY_URL_KEY)
  if (!url) return []
  const profile: ServerProfile = { id: newId(), name: deriveProfileName(url), url, lastUsedAt: Date.now() }
  const legacyToken = read(LEGACY_TOKEN_KEY)
  if (legacyToken) write(localTokenKey(profile.id), legacyToken)
  // The old single keychain entry is adopted by the shell on this profile's behalf.
  write(LEGACY_TOKEN_PROFILE_KEY, profile.id)
  save([profile])
  write(ACTIVE_KEY, profile.id)
  write(LEGACY_URL_KEY, null)
  write(LEGACY_TOKEN_KEY, null)
  return [profile]
}

export function getProfiles(): ServerProfile[] {
  const raw = read(PROFILES_KEY)
  if (raw === null) return migrateLegacy()
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isProfile) : []
  } catch {
    return []
  }
}

export function getActiveProfile(): ServerProfile | null {
  const id = read(ACTIVE_KEY)
  return getProfiles().find((p) => p.id === id) ?? null
}

export function getActiveProfileId(): string | null {
  return getActiveProfile()?.id ?? null
}

/**
 * Adds a server, or returns the existing profile with the same address (so connecting twice to one
 * server doesn't duplicate it). Doesn't make it active. An empty name is derived from the host.
 */
export function addProfile(url: string, name?: string): ServerProfile {
  const profiles = getProfiles()
  write(LAST_SERVER_URL_KEY, url)
  const existing = profiles.find((p) => p.url === url)
  if (existing) return existing
  const profile: ServerProfile = {
    id: newId(),
    name: name?.trim() || deriveProfileName(url, profiles.map((p) => p.name)),
    url,
    lastUsedAt: Date.now(),
  }
  save([...profiles, profile])
  return profile
}

/** Makes a profile the one the app talks to from the next load on, and stamps its last-used time. */
export function activateProfile(id: string) {
  const profiles = getProfiles()
  if (!profiles.some((p) => p.id === id)) return
  // The active id is written first: `save` notifies subscribers synchronously and they read it.
  write(ACTIVE_KEY, id)
  save(profiles.map((p) => (p.id === id ? { ...p, lastUsedAt: Date.now() } : p)))
}

/** No active server: the app shows the connect screen. Profiles and their tokens stay. */
export function deactivateProfile() {
  write(ACTIVE_KEY, null)
  window.dispatchEvent(new Event(CHANGED_EVENT))
}

export function updateProfile(id: string, changes: Partial<Pick<ServerProfile, "name" | "url">>) {
  save(getProfiles().map((p) => (p.id === id ? { ...p, ...changes } : p)))
  if (changes.url) write(LAST_SERVER_URL_KEY, changes.url)
}

/** Forgets the profile (its token is the caller's to clear — see removeProfile in server.ts). */
export function deleteProfile(id: string) {
  if (read(ACTIVE_KEY) === id) write(ACTIVE_KEY, null)
  save(getProfiles().filter((p) => p.id !== id))
}

export function getLastServerUrl(): string {
  return read(LAST_SERVER_URL_KEY) ?? ""
}

// "Add server…" shows the connect screen even though a server is active. Per window session, so a
// forgotten flag can't trap the next launch on it.
export function isAddingServer(): boolean {
  try {
    return window.sessionStorage.getItem(ADDING_KEY) === "1"
  } catch {
    return false
  }
}

export function setAddingServer(adding: boolean) {
  try {
    if (adding) window.sessionStorage.setItem(ADDING_KEY, "1")
    else window.sessionStorage.removeItem(ADDING_KEY)
  } catch {
    // sessionStorage unavailable — the connect screen just won't be reachable from the switcher
  }
}

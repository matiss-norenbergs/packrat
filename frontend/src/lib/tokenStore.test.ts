import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

// The token cache is module state, so each test gets a fresh copy.
async function load() {
  vi.resetModules()
  return import("@/lib/server")
}

const LEGACY = "legacy"

// A stand-in keychain behind the mocked commands: one secret per profile id, plus the single
// pre-profiles entry (LEGACY) that token_adopt_legacy moves.
function keychain(initial: Record<string, string> = {}, kind: "keychain" | "local" = "keychain") {
  const secrets: Record<string, string> = { ...initial }
  invoke.mockImplementation(async (cmd: string, args?: { id: string; token: string }) => {
    if (cmd === "token_store_kind") return kind
    if (cmd === "token_get") return secrets[args!.id] ?? null
    if (cmd === "token_set") secrets[args!.id] = args!.token
    if (cmd === "token_clear") delete secrets[args!.id]
    if (cmd === "token_adopt_legacy") {
      const old = secrets[LEGACY]
      if (old !== undefined) {
        if (secrets[args!.id] === undefined) secrets[args!.id] = old
        delete secrets[LEGACY]
      }
    }
  })
  return { secrets }
}

function saveProfiles(active: string | null, ...ids: string[]) {
  localStorage.setItem(
    "packrat.profiles",
    JSON.stringify(ids.map((id) => ({ id, name: id, url: `http://${id}:1`, lastUsedAt: 1 }))),
  )
  if (active) localStorage.setItem("packrat.activeProfile", active)
}

beforeEach(() => {
  invoke.mockReset()
  localStorage.clear()
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
})
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
})

describe("token storage in the shell", () => {
  it("loads the active profile's token from the keychain before first use", async () => {
    keychain({ a: "token-a", b: "token-b" })
    saveProfiles("a", "a", "b")
    const s = await load()
    await s.initTokenStore()
    expect(s.getTokenStorage()).toBe("keychain")
    expect(s.getToken()).toBe("token-a")
    expect(invoke).toHaveBeenCalledWith("token_get", { id: "a" })
    expect(invoke).not.toHaveBeenCalledWith("token_get", { id: "b" })
  })

  it("holds tokenReady (the auth prefetch gate) until the token is loaded", async () => {
    keychain({ a: "from-keychain" })
    saveProfiles("a", "a")
    const s = await load()
    let ready = false
    void s.tokenReady.then(() => (ready = true))
    await new Promise((r) => setTimeout(r, 0))
    expect(ready).toBe(false)
    await s.initTokenStore()
    await s.tokenReady
    expect(ready).toBe(true)
  })

  it("writes through to the profile's keychain entry and keeps it out of localStorage", async () => {
    const kc = keychain()
    saveProfiles("a", "a", "b")
    const s = await load()
    await s.initTokenStore()
    s.setToken("abc")
    expect(s.getToken()).toBe("abc")
    expect(kc.secrets).toEqual({ a: "abc" })
    expect(localStorage.getItem("packrat.token.a")).toBeNull()
    s.clearToken()
    expect(s.getToken()).toBeNull()
    expect(kc.secrets).toEqual({})
  })

  it("never serves or clears another profile's token", async () => {
    const kc = keychain({ a: "token-a", b: "token-b" })
    saveProfiles("a", "a", "b")
    const s = await load()
    await s.initTokenStore()
    s.clearToken() // logs out of a only
    expect(kc.secrets).toEqual({ b: "token-b" })
    // Without a reload the in-memory copy must not leak to a profile it doesn't belong to.
    s.switchProfile("b")
    expect(s.getToken()).toBeNull()
    expect(kc.secrets).toEqual({ b: "token-b" })
  })

  it("switching profiles clears nothing; the next load picks up the other profile's token", async () => {
    const kc = keychain({ a: "token-a", b: "token-b" })
    saveProfiles("a", "a", "b")
    let s = await load()
    await s.initTokenStore()
    s.switchProfile("b")
    expect(kc.secrets).toEqual({ a: "token-a", b: "token-b" })
    s = await load() // the reload
    await s.initTokenStore()
    expect(s.getToken()).toBe("token-b")
    s.switchProfile("a")
    s = await load()
    await s.initTokenStore()
    expect(s.getToken()).toBe("token-a")
    expect(kc.secrets).toEqual({ a: "token-a", b: "token-b" })
  })

  it("removing a profile deletes only its keychain entry", async () => {
    const kc = keychain({ a: "token-a", b: "token-b" })
    saveProfiles("a", "a", "b")
    localStorage.setItem("packrat.token.b", "stale")
    const s = await load()
    await s.initTokenStore()
    await s.removeProfile("b")
    expect(kc.secrets).toEqual({ a: "token-a" })
    expect(localStorage.getItem("packrat.token.b")).toBeNull()
    expect(s.getProfiles().map((p) => p.id)).toEqual(["a"])
    expect(s.getToken()).toBe("token-a")
  })

  it("changing a profile's address drops its token so it is never sent to the new address", async () => {
    const kc = keychain({ a: "token-a", b: "token-b" })
    saveProfiles("a", "a", "b")
    const s = await load()
    await s.initTokenStore()
    await s.changeProfileUrl("a", "http://elsewhere:2")
    expect(kc.secrets).toEqual({ b: "token-b" })
    expect(s.getToken()).toBeNull()
    expect(s.getServerUrl()).toBe("http://elsewhere:2")
  })

  it("migrates a localStorage token into an empty keychain", async () => {
    const kc = keychain()
    saveProfiles("a", "a")
    localStorage.setItem("packrat.token.a", "legacy")
    const s = await load()
    await s.initTokenStore()
    expect(kc.secrets).toEqual({ a: "legacy" })
    expect(s.getToken()).toBe("legacy")
    expect(localStorage.getItem("packrat.token.a")).toBeNull()
  })

  it("keeps the keychain's token when both exist, and still drops the stale file copy", async () => {
    keychain({ a: "current" })
    saveProfiles("a", "a")
    localStorage.setItem("packrat.token.a", "stale")
    const s = await load()
    await s.initTokenStore()
    expect(s.getToken()).toBe("current")
    expect(localStorage.getItem("packrat.token.a")).toBeNull()
  })

  it("falls back to localStorage when the keychain is unavailable", async () => {
    keychain({}, "local")
    saveProfiles("a", "a")
    localStorage.setItem("packrat.token.a", "legacy")
    const s = await load()
    await s.initTokenStore()
    expect(s.getTokenStorage()).toBe("local")
    expect(s.getToken()).toBe("legacy")
    s.setToken("new")
    expect(localStorage.getItem("packrat.token.a")).toBe("new")
  })

  it("does not lose the login when the migration write fails", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "token_store_kind") return "keychain"
      if (cmd === "token_get") return null
      throw new Error("locked")
    })
    saveProfiles("a", "a")
    localStorage.setItem("packrat.token.a", "legacy")
    const s = await load()
    await s.initTokenStore()
    expect(s.getTokenStorage()).toBe("local")
    expect(s.getToken()).toBe("legacy")
  })

  it("keeps the login in localStorage if a later keychain write fails", async () => {
    keychain()
    saveProfiles("a", "a")
    const s = await load()
    await s.initTokenStore()
    invoke.mockRejectedValue(new Error("locked"))
    s.setToken("abc")
    await new Promise((r) => setTimeout(r, 0))
    expect(s.getTokenStorage()).toBe("local")
    expect(s.getToken()).toBe("abc")
  })

  it("loads with no token and no error when no server is chosen yet", async () => {
    keychain()
    const s = await load()
    await s.initTokenStore()
    expect(s.getTokenStorage()).toBe("keychain")
    expect(s.getToken()).toBeNull()
  })
})

describe("upgrading from a single server and token", () => {
  it("makes them the first profile, keeps the login, and moves the keychain entry", async () => {
    const kc = keychain({ [LEGACY]: "old-login" })
    localStorage.setItem("packrat.serverUrl", "http://nas:50505")
    const s = await load()
    await s.initTokenStore()
    const [profile, ...rest] = s.getProfiles()
    expect(rest).toEqual([])
    expect(profile).toMatchObject({ name: "nas:50505", url: "http://nas:50505" })
    expect(s.getServerUrl()).toBe("http://nas:50505")
    expect(s.getToken()).toBe("old-login")
    // Moved, not orphaned and not duplicated.
    expect(kc.secrets).toEqual({ [profile.id]: "old-login" })
    expect(localStorage.getItem("packrat.serverUrl")).toBeNull()
    expect(localStorage.getItem("packrat.legacyTokenProfile")).toBeNull()
  })

  it("moves a pre-keychain localStorage token too", async () => {
    const kc = keychain()
    localStorage.setItem("packrat.serverUrl", "http://nas:50505")
    localStorage.setItem("packrat.token", "very-old")
    const s = await load()
    await s.initTokenStore()
    const id = s.getProfiles()[0].id
    expect(s.getToken()).toBe("very-old")
    expect(kc.secrets).toEqual({ [id]: "very-old" })
    expect(localStorage.getItem("packrat.token")).toBeNull()
    expect(localStorage.getItem(`packrat.token.${id}`)).toBeNull()
  })

  it("retries the keychain move on the next start if it failed, for the same profile", async () => {
    const secrets: Record<string, string> = { [LEGACY]: "old-login" }
    let failAdopt = true
    invoke.mockImplementation(async (cmd: string, args?: { id: string; token: string }) => {
      if (cmd === "token_store_kind") return "keychain"
      if (cmd === "token_get") return secrets[args!.id] ?? null
      if (cmd === "token_adopt_legacy") {
        if (failAdopt) throw new Error("locked")
        secrets[args!.id] = secrets[LEGACY]
        delete secrets[LEGACY]
      }
    })
    localStorage.setItem("packrat.serverUrl", "http://nas:50505")
    let s = await load()
    await s.initTokenStore()
    const first = s.getProfiles()[0]
    expect(s.getToken()).toBeNull()

    // A second server is added and made active before the next start...
    s.setServerUrl("http://other:1")
    failAdopt = false
    s = await load()
    await s.initTokenStore()
    // ...but the old login still goes to the first profile, not the active one.
    expect(secrets).toEqual({ [first.id]: "old-login" })
    expect(s.getToken()).toBeNull()
    s.switchProfile(first.id)
    s = await load()
    await s.initTokenStore()
    expect(s.getToken()).toBe("old-login")
  })
})

describe("token storage outside the shell", () => {
  it("has nothing to wait for", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    const s = await load()
    await expect(s.tokenReady).resolves.toBeUndefined()
  })

  it("never touches the keychain", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    saveProfiles("a", "a")
    const s = await load()
    await s.initTokenStore()
    s.setToken("abc")
    expect(localStorage.getItem("packrat.token.a")).toBe("abc")
    expect(invoke).not.toHaveBeenCalled()
  })
})

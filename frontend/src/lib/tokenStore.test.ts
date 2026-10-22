import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

// The token cache is module state, so each test gets a fresh copy.
async function load() {
  vi.resetModules()
  return import("@/lib/server")
}

// A stand-in keychain behind the mocked commands.
function keychain(initial: string | null, kind: "keychain" | "local" = "keychain") {
  let secret = initial
  invoke.mockImplementation(async (cmd: string, args?: { token: string }) => {
    if (cmd === "token_store_kind") return kind
    if (cmd === "token_get") return secret
    if (cmd === "token_set") secret = args!.token
    if (cmd === "token_clear") secret = null
  })
  return { read: () => secret }
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
  it("loads the token from the keychain before first use", async () => {
    keychain("from-keychain")
    const s = await load()
    await s.initTokenStore()
    expect(s.getTokenStorage()).toBe("keychain")
    expect(s.getToken()).toBe("from-keychain")
  })

  it("holds tokenReady (the auth prefetch gate) until the token is loaded", async () => {
    keychain("from-keychain")
    const s = await load()
    let ready = false
    void s.tokenReady.then(() => (ready = true))
    await new Promise((r) => setTimeout(r, 0))
    expect(ready).toBe(false)
    await s.initTokenStore()
    await s.tokenReady
    expect(ready).toBe(true)
  })

  it("writes through to the keychain and keeps it out of localStorage", async () => {
    const kc = keychain(null)
    const s = await load()
    await s.initTokenStore()
    s.setToken("abc")
    expect(s.getToken()).toBe("abc")
    expect(kc.read()).toBe("abc")
    expect(localStorage.getItem("packrat.token")).toBeNull()
    s.clearToken()
    expect(s.getToken()).toBeNull()
    expect(kc.read()).toBeNull()
  })

  it("migrates a localStorage token into an empty keychain", async () => {
    const kc = keychain(null)
    localStorage.setItem("packrat.token", "legacy")
    const s = await load()
    await s.initTokenStore()
    expect(kc.read()).toBe("legacy")
    expect(s.getToken()).toBe("legacy")
    expect(localStorage.getItem("packrat.token")).toBeNull()
  })

  it("keeps the keychain's token when both exist, and still drops the stale file copy", async () => {
    keychain("current")
    localStorage.setItem("packrat.token", "stale")
    const s = await load()
    await s.initTokenStore()
    expect(s.getToken()).toBe("current")
    expect(localStorage.getItem("packrat.token")).toBeNull()
  })

  it("falls back to localStorage when the keychain is unavailable", async () => {
    keychain(null, "local")
    localStorage.setItem("packrat.token", "legacy")
    const s = await load()
    await s.initTokenStore()
    expect(s.getTokenStorage()).toBe("local")
    expect(s.getToken()).toBe("legacy")
    s.setToken("new")
    expect(localStorage.getItem("packrat.token")).toBe("new")
  })

  it("does not lose the login when the migration write fails", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "token_store_kind") return "keychain"
      if (cmd === "token_get") return null
      throw new Error("locked")
    })
    localStorage.setItem("packrat.token", "legacy")
    const s = await load()
    await s.initTokenStore()
    expect(s.getTokenStorage()).toBe("local")
    expect(s.getToken()).toBe("legacy")
  })

  it("keeps the login in localStorage if a later keychain write fails", async () => {
    keychain(null)
    const s = await load()
    await s.initTokenStore()
    invoke.mockRejectedValue(new Error("locked"))
    s.setToken("abc")
    await new Promise((r) => setTimeout(r, 0))
    expect(s.getTokenStorage()).toBe("local")
    expect(s.getToken()).toBe("abc")
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
    const s = await load()
    await s.initTokenStore()
    s.setToken("abc")
    expect(localStorage.getItem("packrat.token")).toBe("abc")
    expect(invoke).not.toHaveBeenCalled()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchAuthStatus, fetchLibraryFacets, login } from "@/lib/api"
import { getActiveProfileId } from "@/lib/serverProfiles"
import { getToken, initTokenStore, setServerUrl, setToken, switchProfile, UNAUTHORIZED_EVENT } from "@/lib/server"

// The Tauri shell's keychain commands, recorded.
const keychain = new Map<string, string>()
const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  const id = args?.id as string
  if (cmd === "token_store_kind") return "keychain"
  if (cmd === "token_get") return keychain.get(id) ?? null
  if (cmd === "token_set") return void keychain.set(id, args?.token as string)
  if (cmd === "token_clear") return void keychain.delete(id)
  return null
})
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args) }))

function respond(status: number, body: unknown = {}, gate?: Promise<void>) {
  const fn = vi.fn(async () => {
    await gate
    return { ok: status >= 200 && status < 300, status, statusText: String(status), json: async () => body }
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

let unauthorized: () => void & ReturnType<typeof vi.fn>
beforeEach(() => {
  window.localStorage.clear()
  keychain.clear()
  invoke.mockClear()
  unauthorized = vi.fn() as typeof unauthorized
  window.addEventListener(UNAUTHORIZED_EVENT, unauthorized)
})
afterEach(() => {
  window.removeEventListener(UNAUTHORIZED_EVENT, unauthorized)
  delete (window as any).__TAURI_INTERNALS__
})

describe("web 401 handling", () => {
  it("a 401 from a protected route signals the app (no token to clear)", async () => {
    respond(401, { error: "unauthorized" })
    await expect(fetchLibraryFacets()).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  it("a 401 from /auth/* (wrong password) does not", async () => {
    respond(401, { error: "invalid username or password" })
    await expect(login({ username: "a", password: "x" })).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it("other errors do not", async () => {
    respond(500, { error: "boom" })
    await expect(fetchLibraryFacets()).rejects.toMatchObject({ status: 500 })
    expect(unauthorized).not.toHaveBeenCalled()
  })
})

describe("desktop 401 only touches the login it was sent with", () => {
  let a: string
  let b: string
  beforeEach(async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true })
    setServerUrl("http://a.test", "A")
    a = getActiveProfileId()!
    keychain.set(a, "tokA")
    await initTokenStore() // loads A's token into the keychain cache
    setServerUrl("http://b.test", "B")
    b = getActiveProfileId()!
    switchProfile(a)
    invoke.mockClear()
  })

  it("a 401 for the still-active profile and token clears it and signals", async () => {
    respond(401, { error: "unauthorized" })
    await expect(fetchLibraryFacets()).rejects.toMatchObject({ status: 401 })
    expect(invoke).toHaveBeenCalledWith("token_clear", { id: a })
    expect(getToken()).toBeNull()
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  it("a 401 landing after a switch to another profile does not clear it, nor signal", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    respond(401, { error: "unauthorized" }, gate)
    const pending = fetchLibraryFacets() // sent as profile A with tokA
    switchProfile(b) // the keychain cache still belongs to A: B has no token in memory yet
    keychain.set(b, "tokB")
    release()
    await expect(pending).rejects.toMatchObject({ status: 401 })
    expect(invoke).not.toHaveBeenCalledWith("token_clear", expect.anything())
    expect(keychain.get(b)).toBe("tokB")
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it("a 401 for a token that was replaced meanwhile (re-login) is ignored", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    respond(401, { error: "unauthorized" }, gate)
    const pending = fetchLibraryFacets()
    setToken("tokA2")
    release()
    await expect(pending).rejects.toMatchObject({ status: 401 })
    expect(invoke).not.toHaveBeenCalledWith("token_clear", expect.anything())
    expect(getToken()).toBe("tokA2")
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it("fetchAuthStatus: a dead-token answer clears the token it was sent with", async () => {
    respond(200, { setupRequired: false, authenticated: false })
    await fetchAuthStatus()
    expect(invoke).toHaveBeenCalledWith("token_clear", { id: a })
  })

  it("fetchAuthStatus: an answer landing after a profile switch leaves the new profile's login", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    respond(200, { setupRequired: false, authenticated: false }, gate)
    const pending = fetchAuthStatus()
    switchProfile(b)
    keychain.set(b, "tokB")
    release()
    await pending
    expect(invoke).not.toHaveBeenCalledWith("token_clear", expect.anything())
    expect(keychain.get(b)).toBe("tokB")
  })
})

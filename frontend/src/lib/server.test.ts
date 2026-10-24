import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  apiBase,
  clearToken,
  getServerUrl,
  getToken,
  isDesktop,
  needsServerUrl,
  normalizeServerUrl,
  changeProfileUrl,
  getProfiles,
  probeServer,
  removeProfile,
  resetServer,
  serverUrl,
  setServerUrl,
  setToken,
  websocketUrl,
} from "@/lib/server"

function enterDesktop() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true })
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__TAURI_INTERNALS__
  vi.unstubAllGlobals()
})

describe("normalizeServerUrl", () => {
  it.each([
    ["192.168.1.5:50505", "http://192.168.1.5:50505"],
    ["  http://nas.local:50505/  ", "http://nas.local:50505"],
    ["https://packrat.example.com/", "https://packrat.example.com"],
    ["https://example.com/packrat/", "https://example.com/packrat"],
    ["https://example.com/?x=1#y", "https://example.com"],
  ])("%s -> %s", (input, want) => expect(normalizeServerUrl(input)).toBe(want))

  it.each(["", "   ", "ftp://host", "http://", "javascript:alert(1)"])("rejects %j", (input) =>
    expect(normalizeServerUrl(input)).toBeNull(),
  )
})

describe("web (not desktop)", () => {
  it("leaves every URL alone and ignores a stored server/token", () => {
    setServerUrl("http://other:1")
    setToken("abc")
    expect(isDesktop()).toBe(false)
    expect(needsServerUrl()).toBe(false)
    expect(apiBase()).toBe("")
    expect(serverUrl("/media-files/a b.mp4")).toBe("/media-files/a b.mp4")
    expect(websocketUrl()).toBe(`ws://${window.location.host}/ws`)
  })
})

describe("desktop", () => {
  beforeEach(enterDesktop)

  it("needs a server address until one is saved", () => {
    expect(isDesktop()).toBe(true)
    expect(needsServerUrl()).toBe(true)
    setServerUrl("http://nas:50505")
    expect(needsServerUrl()).toBe(false)
    expect(apiBase()).toBe("http://nas:50505")
  })

  it("prefixes the server and appends the token to loadable URLs", () => {
    setServerUrl("http://nas:50505")
    expect(serverUrl("/media-files/a.mp4")).toBe("http://nas:50505/media-files/a.mp4")
    setToken("t0k/en")
    expect(serverUrl("/media-files/a.mp4")).toBe("http://nas:50505/media-files/a.mp4?token=t0k%2Fen")
    expect(serverUrl("/api/image?root=media&w=320")).toBe("http://nas:50505/api/image?root=media&w=320&token=t0k%2Fen")
  })

  it("builds the websocket URL from the server address", () => {
    setServerUrl("https://packrat.example.com/app")
    setToken("abc")
    expect(websocketUrl()).toBe("wss://packrat.example.com/app/ws?token=abc")
    setServerUrl("http://nas:50505")
    expect(websocketUrl()).toBe("ws://nas:50505/ws")
  })

  it("keeps a separate token per server, and resetServer leaves them be", () => {
    setServerUrl("http://a:1")
    setToken("abc")
    setServerUrl("http://a:1")
    expect(getToken()).toBe("abc")
    setServerUrl("http://b:2")
    expect(getToken()).toBeNull()

    setToken("def")
    resetServer()
    expect(getServerUrl()).toBeNull()
    expect(getToken()).toBeNull()
    // Both logins survived: coming back to either server finds its own token.
    setServerUrl("http://a:1")
    expect(getToken()).toBe("abc")
    setServerUrl("http://b:2")
    expect(getToken()).toBe("def")
    clearToken()
    expect(getToken()).toBeNull()
    setServerUrl("http://a:1")
    expect(getToken()).toBe("abc")
  })
})

describe("signing out on the old server", () => {
  beforeEach(enterDesktop)
  const idOf = (url: string) => getProfiles().find((p) => p.url === url)!.id

  // Two servers, each with its own login; `active` is the one the app is on.
  function twoServers(active: "http://a:1" | "http://b:2") {
    setServerUrl("http://a:1")
    setToken("token-a")
    setServerUrl("http://b:2")
    setToken("token-b")
    setServerUrl(active)
  }

  it("removing the active server signs out on it with its token, then clears the login", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchMock)
    twoServers("http://a:1")
    const id = idOf("http://a:1")
    await removeProfile(id)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      "http://a:1/api/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "omit", headers: { Authorization: "Bearer token-a" } }),
    )
    expect(window.localStorage.getItem(`packrat.token.${id}`)).toBeNull()
    expect(getServerUrl()).toBeNull()
  })

  it("removing a non-active server uses that server's token, not the active one's", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchMock)
    twoServers("http://a:1")
    await removeProfile(idOf("http://b:2"))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      "http://b:2/api/auth/logout",
      expect.objectContaining({ headers: { Authorization: "Bearer token-b" } }),
    )
    // The active server's login is untouched.
    expect(getServerUrl()).toBe("http://a:1")
    expect(getToken()).toBe("token-a")
  })

  it("changing the address signs out on the old one and never sends the token to the new one", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchMock)
    twoServers("http://b:2")
    await changeProfileUrl(idOf("http://b:2"), "http://new:3")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("http://b:2/api/auth/logout")
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("http://new:3"))).toBe(false)
    expect(getServerUrl()).toBe("http://new:3")
    expect(getToken()).toBeNull()
  })

  it("still removes the server when it is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    twoServers("http://a:1")
    const id = idOf("http://b:2")
    await expect(removeProfile(id)).resolves.toBeUndefined()
    expect(getProfiles().map((p) => p.url)).toEqual(["http://a:1"])
    expect(window.localStorage.getItem(`packrat.token.${id}`)).toBeNull()
  })

  it("gives up after a few seconds, and the removal still completes", async () => {
    vi.useFakeTimers()
    try {
      // A server that never answers: settles only when the request's abort signal fires.
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init: RequestInit) => {
          return new Promise((_resolve, reject) => {
            init.signal!.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")))
          })
        }),
      )
      twoServers("http://a:1")
      const done = removeProfile(idOf("http://b:2"))
      await vi.advanceTimersByTimeAsync(3100)
      await expect(done).resolves.toBeUndefined()
      expect(getProfiles().map((p) => p.url)).toEqual(["http://a:1"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("skips the request when the server has no saved login", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    setServerUrl("http://a:1")
    await removeProfile(idOf("http://a:1"))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("probeServer", () => {
  const respond = (init: { ok: boolean; status?: number; body?: unknown }) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: init.ok, status: init.status ?? 200, json: async () => init.body })),
    )

  it("accepts a Packrat health response", async () => {
    respond({ ok: true, body: { status: "ok" } })
    expect(await probeServer("http://nas:1")).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith("http://nas:1/api/health", expect.objectContaining({ credentials: "omit" }))
  })

  it("rejects non-Packrat and unreachable servers", async () => {
    respond({ ok: true, body: { hello: "world" } })
    expect((await probeServer("http://x")).ok).toBe(false)
    respond({ ok: false, status: 404 })
    expect((await probeServer("http://x")).ok).toBe(false)
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    const r = await probeServer("http://x")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/CORS_ALLOWED_ORIGINS/)
  })
})

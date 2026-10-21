import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  apiBase,
  clearToken,
  getServerUrl,
  getToken,
  isDesktop,
  needsServerUrl,
  normalizeServerUrl,
  probeServer,
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

  it("drops the old token when the server changes, and remembers the address on reset", () => {
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
    clearToken()
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

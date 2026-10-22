import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { backupDownloadUrl, fetchAuthStatus, imageUrl, login, logout, mediaFileUrl, resizedImageSrcSet, fetchLibraryFacets } from "@/lib/api"
import { getServerUrl, getToken, setServerUrl, setToken, UNAUTHORIZED_EVENT } from "@/lib/server"

type FetchInit = { credentials?: string; headers: Record<string, string>; method?: string }

function mockFetch(responder: (url: string, init: FetchInit) => { status: number; body?: unknown }) {
  const fn = vi.fn(async (url: string, init: FetchInit) => {
    const { status, body } = responder(url, init)
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      json: async () => body ?? {},
    }
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

function enterDesktop() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true })
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__TAURI_INTERNALS__
  vi.unstubAllGlobals()
  document.cookie = "packrat_csrf=; Max-Age=0"
})

describe("web request()", () => {
  it("is unchanged: same-origin, cookies + CSRF header, no Authorization", async () => {
    document.cookie = "packrat_csrf=csrf123"
    setToken("ignored")
    const fetchMock = mockFetch(() => ({ status: 200, body: { tags: [] } }))
    await fetchLibraryFacets()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/library/facets")
    expect(init.credentials).toBe("include")
    expect(init.headers["X-CSRF-Token"]).toBe("csrf123")
    expect(init.headers.Authorization).toBeUndefined()
    expect(init.headers["X-Client"]).toBeUndefined()
  })

  it("login makes the same call and stores nothing", async () => {
    const fetchMock = mockFetch(() => ({ status: 204 }))
    await login({ username: "a", password: "b" })
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/login")
    expect(getToken()).toBeNull()
  })

  it("leaves media/image/backup URLs relative", () => {
    expect(mediaFileUrl("a/b c.mp4")).toBe("/media-files/a/b%20c.mp4")
    expect(imageUrl("x/y.jpg")).toBe("/local-images/x/y.jpg")
    expect(backupDownloadUrl(3)).toBe("/api/backup/history/3/download")
    expect(resizedImageSrcSet({ root: "media", path: "a.jpg", widths: [320] })).toBe("/api/image?root=media&path=a.jpg&w=320 320w")
  })
})

describe("desktop request()", () => {
  beforeEach(() => {
    enterDesktop()
    setServerUrl("http://nas:50505")
  })

  it("calls the server with a bearer token, no cookies and no CSRF header", async () => {
    setToken("tok")
    document.cookie = "packrat_csrf=csrf123"
    const fetchMock = mockFetch(() => ({ status: 200, body: {} }))
    await fetchLibraryFacets()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://nas:50505/api/library/facets")
    expect(init.credentials).toBe("omit")
    expect(init.headers.Authorization).toBe("Bearer tok")
    expect(init.headers["X-Client"]).toBe("desktop")
    expect(init.headers["X-CSRF-Token"]).toBeUndefined()
  })

  it("login stores the token from the response body", async () => {
    mockFetch(() => ({ status: 200, body: { token: "fresh" } }))
    await login({ username: "a", password: "b" })
    expect(getToken()).toBe("fresh")
  })

  it("puts the server and token on URLs the browser loads directly", async () => {
    setToken("tok")
    expect(mediaFileUrl("a/b c.mp4")).toBe("http://nas:50505/media-files/a/b%20c.mp4?token=tok")
    expect(imageUrl("x/y.jpg")).toBe("http://nas:50505/local-images/x/y.jpg?token=tok")
    expect(backupDownloadUrl(3)).toBe("http://nas:50505/api/backup/history/3/download?token=tok")
    expect(resizedImageSrcSet({ root: "images", path: "a.jpg", widths: [320, 480] })).toBe(
      "http://nas:50505/api/image?root=images&path=a.jpg&w=320&token=tok 320w, http://nas:50505/api/image?root=images&path=a.jpg&w=480&token=tok 480w",
    )
  })

  it("on a 401 from a protected route, forgets the token and signals the app", async () => {
    setToken("stale")
    const onUnauthorized = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    mockFetch(() => ({ status: 401, body: { error: "unauthorized" } }))
    await expect(fetchLibraryFacets()).rejects.toMatchObject({ status: 401 })
    window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    expect(getToken()).toBeNull()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(getServerUrl()).toBe("http://nas:50505")
  })

  it("does not treat a wrong password (401 from /auth/login) as an expired session", async () => {
    setToken("keep")
    const onUnauthorized = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    mockFetch(() => ({ status: 401, body: { error: "invalid username or password" } }))
    await expect(login({ username: "a", password: "wrong" })).rejects.toMatchObject({ status: 401 })
    window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    expect(getToken()).toBe("keep")
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it("drops a stale token when the status check says it is no longer authenticated", async () => {
    setToken("stale")
    mockFetch(() => ({ status: 200, body: { setupRequired: false, authenticated: false } }))
    await fetchAuthStatus()
    expect(getToken()).toBeNull()
    setToken("good")
    mockFetch(() => ({ status: 200, body: { setupRequired: false, authenticated: true } }))
    await fetchAuthStatus()
    expect(getToken()).toBe("good")
  })

  it("reports network failures (not HTTP errors) to the connection monitor", async () => {
    const connection = await import("@/lib/connection")
    const failure = vi.spyOn(connection, "reportNetworkFailure").mockResolvedValue()
    const reachable = vi.spyOn(connection, "reportReachable").mockImplementation(() => {})

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    await expect(fetchLibraryFacets()).rejects.toThrow()
    expect(failure).toHaveBeenCalledTimes(1)

    mockFetch(() => ({ status: 500, body: { error: "boom" } }))
    await expect(fetchLibraryFacets()).rejects.toMatchObject({ status: 500 })
    expect(failure).toHaveBeenCalledTimes(1)
    expect(reachable).toHaveBeenCalled()
  })

  it("logout clears the token even when the server is unreachable", async () => {
    setToken("tok")
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    await expect(logout()).rejects.toThrow()
    expect(getToken()).toBeNull()
  })
})

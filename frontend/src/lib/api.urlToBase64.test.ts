import { afterEach, describe, expect, it, vi } from "vitest"
import { urlToBase64 } from "@/lib/api"
import { UNAUTHORIZED_EVENT } from "@/lib/server"

function respond(status: number, type: string | null, body: BlobPart = "x") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(type ? { "Content-Type": type } : {}),
      blob: async () => new Blob([body], type ? { type } : {}),
    })),
  )
}
afterEach(() => vi.unstubAllGlobals())

describe("urlToBase64", () => {
  it.each([401, 404, 500])("rejects with the status on a %i", async (status) => {
    respond(status, "application/json", "{}")
    await expect(urlToBase64("/media-files/a.jpg")).rejects.toThrow(`HTTP ${status}`)
  })

  it("rejects an HTML 200 instead of encoding it", async () => {
    respond(200, "text/html", "<html></html>")
    await expect(urlToBase64("/media-files/a.jpg")).rejects.toThrow(/not an image: text\/html/)
  })

  it("a 401 signals the app like any other request", async () => {
    const onUnauthorized = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    respond(401, "application/json", "{}")
    await expect(urlToBase64("/media-files/a.jpg")).rejects.toThrow()
    window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it("still encodes a real image", async () => {
    respond(200, "image/png", "abc")
    await expect(urlToBase64("/media-files/a.png")).resolves.toBe(btoa("abc"))
  })
})

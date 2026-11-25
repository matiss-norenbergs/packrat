import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { previewImageUrl, remoteThumbnailSrc } from "@/lib/api"
import { setServerUrl, setToken } from "@/lib/server"

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__TAURI_INTERNALS__
})

describe("remoteThumbnailSrc", () => {
  it("proxies an absolute http(s) URL, encoded, as kind=thumbnail", () => {
    const url = "https://cdn.example.com/a b/t.jpg?x=1&y=2"
    expect(remoteThumbnailSrc(url)).toBe(
      `/api/downloads/preview-image?url=${encodeURIComponent(url)}&kind=thumbnail`,
    )
    expect(remoteThumbnailSrc("HTTP://example.com/t.png")).toBe(previewImageUrl("HTTP://example.com/t.png", "thumbnail"))
  })

  it("keeps a server-local path local", () => {
    expect(remoteThumbnailSrc("/media-files/a/t.jpg")).toBe("/media-files/a/t.jpg")
  })

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["null", null],
    ["undefined", undefined],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:image/svg+xml;base64,AAAA"],
    ["file:", "file:///etc/passwd"],
    ["protocol-relative", "//evil.example/t.jpg"],
    ["relative without slash", "t.jpg"],
    ["unparseable http", "http://"],
  ])("renders no image for %s", (_name, value) => {
    expect(remoteThumbnailSrc(value as string | null | undefined)).toBeNull()
  })

  it("desktop mode prefixes the server and adds the token", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true })
    setServerUrl("http://nas:50505")
    setToken("tok")
    expect(remoteThumbnailSrc("https://cdn.example.com/t.jpg")).toBe(
      `http://nas:50505/api/downloads/preview-image?url=${encodeURIComponent("https://cdn.example.com/t.jpg")}&kind=thumbnail&token=tok`,
    )
    expect(remoteThumbnailSrc("/media-files/t.jpg")).toBe("http://nas:50505/media-files/t.jpg?token=tok")
  })
})

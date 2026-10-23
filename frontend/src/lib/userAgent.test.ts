import { describe, expect, it } from "vitest"
import { describeDevice, parseUserAgent } from "@/lib/userAgent"

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const EDGE_WIN = `${CHROME_WIN} Edg/120.0.0.0`
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0"
const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15"
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1"
const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
const TAURI_LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

describe("parseUserAgent", () => {
  it("tells Chromium-based browsers apart", () => {
    expect(parseUserAgent(CHROME_WIN)).toEqual({ browser: "Chrome", os: "Windows" })
    expect(parseUserAgent(EDGE_WIN)).toEqual({ browser: "Edge", os: "Windows" })
    expect(parseUserAgent(`${CHROME_WIN} OPR/106.0`).browser).toBe("Opera")
  })

  it("reads Firefox, Safari and the mobile systems", () => {
    expect(parseUserAgent(FIREFOX_LINUX)).toEqual({ browser: "Firefox", os: "Linux" })
    expect(parseUserAgent(SAFARI_MAC)).toEqual({ browser: "Safari", os: "macOS" })
    expect(parseUserAgent(SAFARI_IPHONE)).toEqual({ browser: "Safari", os: "iOS" })
    expect(parseUserAgent(CHROME_ANDROID)).toEqual({ browser: "Chrome", os: "Android" })
  })

  it("returns nulls for junk", () => {
    expect(parseUserAgent("")).toEqual({ browser: null, os: null })
    expect(parseUserAgent("curl/8.0")).toEqual({ browser: null, os: null })
  })
})

describe("describeDevice", () => {
  it("names a web session by browser and OS", () => {
    expect(describeDevice("web", CHROME_WIN)).toBe("Chrome on Windows")
    expect(describeDevice("web", "curl/8.0")).toBe("Web browser")
  })

  it("names the desktop app instead of its webview", () => {
    expect(describeDevice("desktop", TAURI_LINUX)).toBe("Packrat desktop app on Linux")
    expect(describeDevice("desktop", "")).toBe("Packrat desktop app")
  })

  it("calls a session with no recorded client an unknown device", () => {
    expect(describeDevice("", "")).toBe("Unknown device")
  })
})

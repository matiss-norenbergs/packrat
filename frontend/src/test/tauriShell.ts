// Puts a test inside the Tauri shell: `enterTauri()` is the desktop app, `enterTauri("android")`
// the experimental Android build (same shell, Android WebView's user agent). `leaveTauri()` undoes
// both; call it in afterEach.

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36"

export function enterTauri(platform: "desktop" | "android" = "desktop") {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true })
  if (platform === "android") setUserAgent(ANDROID_UA)
}

export function enterAndroidBrowser() {
  setUserAgent(ANDROID_UA)
}

export function leaveTauri() {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  // Drops the own-property override, so the jsdom default (on the prototype) shows again.
  delete (window.navigator as unknown as Record<string, unknown>).userAgent
}

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, "userAgent", { value, configurable: true })
}

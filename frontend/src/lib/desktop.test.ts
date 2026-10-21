import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const openUrl = vi.fn()
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }))
const sendNotification = vi.fn()
const isPermissionGranted = vi.fn()
const requestPermission = vi.fn()
vi.mock("@tauri-apps/plugin-notification", () => ({ sendNotification, isPermissionGranted, requestPermission }))

function enterTauri() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true })
}

beforeEach(() => {
  vi.resetModules()
  openUrl.mockReset()
  sendNotification.mockReset()
  isPermissionGranted.mockReset()
  requestPermission.mockReset()
})
afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__TAURI_INTERNALS__
  document.body.innerHTML = ""
})

async function click(html: string): Promise<MouseEvent> {
  document.body.innerHTML = html
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
  document.querySelector("a")!.dispatchEvent(event)
  await new Promise((r) => setTimeout(r, 0))
  return event
}

describe("installExternalLinkHandler", () => {
  it("does nothing outside the Tauri shell", async () => {
    const { installExternalLinkHandler } = await import("@/lib/desktop")
    installExternalLinkHandler()
    const event = await click('<a href="https://example.com" target="_blank">x</a>')
    expect(event.defaultPrevented).toBe(false)
    expect(openUrl).not.toHaveBeenCalled()
  })

  describe("in Tauri", () => {
    beforeEach(async () => {
      enterTauri()
      const { installExternalLinkHandler } = await import("@/lib/desktop")
      installExternalLinkHandler()
    })

    it("opens target=_blank and off-origin http(s) links in the system browser", async () => {
      let event = await click('<a href="https://example.com/a" target="_blank">x</a>')
      expect(event.defaultPrevented).toBe(true)
      expect(openUrl).toHaveBeenLastCalledWith("https://example.com/a")
      event = await click('<a href="http://nas:50505/x">x</a>')
      expect(event.defaultPrevented).toBe(true)
      expect(openUrl).toHaveBeenLastCalledWith("http://nas:50505/x")
    })

    it("leaves in-app links, downloads and non-http links alone", async () => {
      for (const html of [
        '<a href="/library">x</a>',
        '<a href="http://nas:50505/backup.zip" download>x</a>',
        '<a href="mailto:a@b.c">x</a>',
      ]) {
        const event = await click(html)
        expect(event.defaultPrevented).toBe(false)
      }
      expect(openUrl).not.toHaveBeenCalled()
    })
  })
})

describe("notifications in Tauri", () => {
  beforeEach(enterTauri)

  it("asks the plugin for permission", async () => {
    const { ensureNotificationPermission } = await import("@/lib/notify")
    isPermissionGranted.mockResolvedValue(true)
    expect(await ensureNotificationPermission()).toBe(true)
    expect(requestPermission).not.toHaveBeenCalled()

    isPermissionGranted.mockResolvedValue(false)
    requestPermission.mockResolvedValue("denied")
    expect(await ensureNotificationPermission()).toBe(false)
    requestPermission.mockResolvedValue("granted")
    expect(await ensureNotificationPermission()).toBe(true)
  })

  it("sends through the plugin, only when permitted", async () => {
    window.localStorage.setItem("packrat-desktop-notifications", "true")
    vi.spyOn(document, "hasFocus").mockReturnValue(false)
    const { notifyDesktop } = await import("@/lib/notify")

    isPermissionGranted.mockResolvedValue(true)
    notifyDesktop("Done", "file.mp4")
    await new Promise((r) => setTimeout(r, 0))
    expect(sendNotification).toHaveBeenCalledWith({ title: "Done", body: "file.mp4" })

    sendNotification.mockClear()
    isPermissionGranted.mockResolvedValue(false)
    notifyDesktop("Done")
    await new Promise((r) => setTimeout(r, 0))
    expect(sendNotification).not.toHaveBeenCalled()
  })
})

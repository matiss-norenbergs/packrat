import { describe, expect, it, vi } from "vitest"
import { CHUNK_RELOAD_WINDOW_MS, isChunkLoadError, reloadForStaleChunk } from "./chunkReload"

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    },
  }
}

describe("isChunkLoadError", () => {
  it.each([
    "Failed to fetch dynamically imported module: http://x/assets/SettingsPage-abc.js",
    "error loading dynamically imported module: http://x/assets/a.js",
    "Importing a module script failed.",
    "Failed to load module script: Expected a JavaScript module script",
    "Unable to preload CSS for /assets/index.css",
  ])("recognises %s", (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true)
  })

  it("accepts plain string errors", () => {
    expect(isChunkLoadError("Importing a module script failed")).toBe(true)
  })

  it("ignores unrelated errors and non-errors", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError({ message: "Failed to fetch dynamically imported module" })).toBe(false)
  })
})

describe("reloadForStaleChunk", () => {
  it("reloads the first time and records the timestamp", () => {
    const reload = vi.fn()
    const storage = memoryStorage()
    expect(reloadForStaleChunk({ now: () => 1_000_000, storage, reload })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(storage.getItem("packrat:chunk-reload-at")).toBe("1000000")
  })

  it("gives up on a second failure inside the window", () => {
    const reload = vi.fn()
    const storage = memoryStorage()
    reloadForStaleChunk({ now: () => 1_000_000, storage, reload })
    const again = reloadForStaleChunk({ now: () => 1_000_000 + CHUNK_RELOAD_WINDOW_MS - 1, storage, reload })
    expect(again).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("reloads again once the window has passed", () => {
    const reload = vi.fn()
    const storage = memoryStorage()
    reloadForStaleChunk({ now: () => 1_000_000, storage, reload })
    const later = reloadForStaleChunk({ now: () => 1_000_000 + CHUNK_RELOAD_WINDOW_MS, storage, reload })
    expect(later).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it("never reloads when sessionStorage can't be accessed", () => {
    const reload = vi.fn()
    const spy = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError")
    })
    expect(reloadForStaleChunk({ reload, now: () => 1 })).toBe(false)
    spy.mockRestore()
    expect(reload).not.toHaveBeenCalled()
  })

  it("never reloads when reading or writing the guard throws", () => {
    const reload = vi.fn()
    const boom = () => {
      throw new Error("denied")
    }
    expect(reloadForStaleChunk({ storage: { getItem: boom, setItem: boom }, reload, now: () => 1 })).toBe(false)
    expect(reloadForStaleChunk({ storage: { getItem: () => null, setItem: boom }, reload, now: () => 1 })).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})

import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach, vi } from "vitest"

// Newer Node versions ship an experimental global `localStorage` that shadows jsdom's and is
// unusable without --localstorage-file; fall back to a plain in-memory Storage in that case.
if (typeof window.localStorage?.clear !== "function") {
  const data = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true })
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })
}

// input-otp polls document.elementFromPoint (password-manager badge detection), which jsdom lacks.
if (typeof document.elementFromPoint !== "function") {
  document.elementFromPoint = () => null
}

// Global per-test hygiene. Vitest runs without `globals`, so Testing Library's automatic
// cleanup never registers; do it here once instead of in every file. Tests must not hand-write
// `afterEach(cleanup)`, `localStorage.clear()` or `vi.unstubAllGlobals()`.
afterEach(() => {
  cleanup()
  // Restore real timers first: a test that left fake ones would otherwise leak them.
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

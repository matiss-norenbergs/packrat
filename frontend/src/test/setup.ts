import "@testing-library/jest-dom/vitest"

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

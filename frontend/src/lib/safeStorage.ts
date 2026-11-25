// localStorage that never throws. Chromium throws SecurityError on `window.localStorage` itself when
// site data is blocked, and setItem throws QuotaExceededError when storage is full; a throw at module
// load or inside an effect/event handler would blank the app or stop later code. Reads fall back to
// an in-memory copy of what this page load wrote, so a toggle still applies for the session.
// Behaviour with working storage is plain localStorage.
const memory = new Map<string, string>()

export function readStorage(key: string): string | null {
  // memory only holds a value whose write failed, so it is newer than whatever storage still has.
  const pending = memory.get(key)
  if (pending !== undefined) return pending
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
    memory.delete(key)
  } catch {
    memory.set(key, value)
  }
}

export function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // storage unavailable
  }
  memory.delete(key)
}

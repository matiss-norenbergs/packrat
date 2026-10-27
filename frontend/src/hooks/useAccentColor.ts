import { useSyncExternalStore } from "react"
import type { AccentPreference } from "@/types/api"

// Applies the accent color to <html> and caches it in localStorage. The cache is only there so the
// right color is on screen before the first paint (and on the logged-out pages); the account's
// saved value lives on the server and is synced in by useAppearance. Same split as the theme
// (next-themes, see App.tsx).
export type AccentColor = AccentPreference

const STORAGE_KEY = "packrat-accent-color"
const ACCENT_COLORS: readonly AccentColor[] = ["default", "blue", "red", "green", "yellow", "mono"]

function isAccentColor(value: string | null): value is AccentColor {
  return value !== null && (ACCENT_COLORS as readonly string[]).includes(value)
}

function readStoredAccent(): AccentColor {
  const stored = localStorage.getItem(STORAGE_KEY)
  return isAccentColor(stored) ? stored : "default"
}

export function applyAccent(accent: AccentColor) {
  if (accent === "default") {
    document.documentElement.removeAttribute("data-accent")
  } else {
    document.documentElement.setAttribute("data-accent", accent)
  }
}

// Applied once at module load (this file is imported from App.tsx, ahead of
// the first render) so the saved accent is already on <html> before
// anything paints — no flash of the default color on a hard refresh.
let current = readStoredAccent()
applyAccent(current)

const listeners = new Set<() => void>()

// Applies the accent, refreshes the cache and tells every mounted useAccentColor.
export function setAccentLocally(next: AccentColor) {
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // storage unavailable — the accent still applies for this page load
  }
  applyAccent(next)
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export function useAccentColor() {
  const accent = useSyncExternalStore(subscribe, () => current)
  return { accent, setAccent: setAccentLocally }
}

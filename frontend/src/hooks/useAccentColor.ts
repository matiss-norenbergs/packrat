import { useEffect, useState } from "react"

// Client-side only, same as the light/dark/system theme choice (next-themes,
// see App.tsx) — a personal browser preference, not something that needs a
// backend Settings round-trip.
export type AccentColor = "default" | "blue" | "red" | "green" | "violet"

const STORAGE_KEY = "packrat-accent-color"
const ACCENT_COLORS: readonly AccentColor[] = ["default", "blue", "red", "green", "violet"]

function isAccentColor(value: string | null): value is AccentColor {
  return value !== null && (ACCENT_COLORS as readonly string[]).includes(value)
}

function readStoredAccent(): AccentColor {
  return isAccentColor(localStorage.getItem(STORAGE_KEY)) ? (localStorage.getItem(STORAGE_KEY) as AccentColor) : "default"
}

function applyAccent(accent: AccentColor) {
  if (accent === "default") {
    document.documentElement.removeAttribute("data-accent")
  } else {
    document.documentElement.setAttribute("data-accent", accent)
  }
}

// Applied once at module load (this file is imported from App.tsx, ahead of
// the first render) so the saved accent is already on <html> before
// anything paints — no flash of the default color on a hard refresh.
applyAccent(readStoredAccent())

export function useAccentColor() {
  const [accent, setAccentState] = useState<AccentColor>(readStoredAccent)

  useEffect(() => {
    applyAccent(accent)
  }, [accent])

  function setAccent(next: AccentColor) {
    localStorage.setItem(STORAGE_KEY, next)
    setAccentState(next)
  }

  return { accent, setAccent }
}

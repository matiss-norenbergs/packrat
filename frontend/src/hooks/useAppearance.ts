import { useEffect, useRef } from "react"
import { useTheme } from "next-themes"
import { setAccentLocally, useAccentColor } from "@/hooks/useAccentColor"
import { usePreferences, useUpdatePreferences } from "@/hooks/usePreferences"
import type { AccentPreference, ThemePreference } from "@/types/api"

// Applies the account's saved appearance once per mount of the authenticated layout. Only the
// first fetch that completes after mount counts (not cached data, not later refetches), so a slow
// response can never overwrite a choice made in the meantime. Applying also refreshes the
// localStorage cache that the pre-paint code and the logged-out pages read.
export function useSyncAppearance() {
  const { setTheme } = useTheme()
  const { data, isFetchedAfterMount } = usePreferences()
  const applied = useRef(false)

  useEffect(() => {
    if (applied.current || !data || !isFetchedAfterMount) return
    applied.current = true
    setTheme(data.theme)
    setAccentLocally(data.accent)
  }, [data, isFetchedAfterMount, setTheme])
}

// Theme + accent: a change applies on this device at once and is saved to the account in the
// background.
export function useAppearance() {
  const { theme, setTheme: setNextTheme } = useTheme()
  const { accent, setAccent: setAccentState } = useAccentColor()
  const update = useUpdatePreferences()

  function setTheme(next: ThemePreference) {
    setNextTheme(next)
    update.mutate({ theme: next })
  }

  function setAccent(next: AccentPreference) {
    setAccentState(next)
    update.mutate({ accent: next })
  }

  return { theme: (theme ?? "system") as ThemePreference, accent, setTheme, setAccent }
}

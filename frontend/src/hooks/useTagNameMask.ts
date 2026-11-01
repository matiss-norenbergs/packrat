import { useCallback, useMemo } from "react"
import { useSettings } from "@/hooks/useSettings"
import { useTags } from "@/hooks/useTags"
import { hashText } from "@/lib/utils"

// Privacy screen for tag names: with privacy on, a private tag's name is shown
// as hashText(name) until `revealed` (per-item click or reveal-all, decided by
// the caller). Private tags are looked up by name in the shared, cached tags
// list. Fails closed: until the settings have loaded privacy counts as on, and
// until the tags have loaded every name counts as potentially private, so a
// private name is never shown for a moment before the lookup is known.
// Library surfaces skip the hook for non-blurred items (a private tag always
// blurs its item, so they can't carry one) by passing revealed = true; only
// the Tags page, which has no item, relies on the lookup alone.
// Display only — search, sort and dialogs keep using real names.
export function maskTagName(
  name: string,
  revealed: boolean,
  privacyEnabled: boolean | undefined,
  privateNames: ReadonlySet<string> | undefined,
): string {
  if (revealed || privacyEnabled === false) return name
  if (privateNames && !privateNames.has(name)) return name
  return hashText(name)
}

export function useTagNameMask(): (name: string, revealed: boolean) => string {
  const { data: settings } = useSettings()
  const { data: tags } = useTags()
  const privacyEnabled = settings?.privacyEnabled
  // Built once per tags list (undefined while not loaded), not per badge.
  const privateNames = useMemo(() => (tags ? new Set(tags.filter((t) => t.isPrivate).map((t) => t.name)) : undefined), [tags])
  return useCallback(
    (name, revealed) => maskTagName(name, revealed, privacyEnabled, privateNames),
    [privacyEnabled, privateNames],
  )
}

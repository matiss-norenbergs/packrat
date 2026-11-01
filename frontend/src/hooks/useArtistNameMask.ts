import { useCallback, useMemo } from "react"
import { useArtists } from "@/hooks/useArtists"
import { useSettings } from "@/hooks/useSettings"
import { hashText } from "@/lib/utils"

// Privacy screen for artist names: with privacy on, a private artist's name is
// shown as hashText(name) until `revealed` (per-item click or reveal-all,
// decided by the caller). Artists are matched by id (items expose `artistId`)
// against the shared, cached artists list. Fails closed like useTagNameMask:
// until the settings have loaded privacy counts as on, and until the artists
// have loaded every artist counts as potentially private.
// Library surfaces pass revealed = true for non-blurred items (a private artist
// always blurs its item); the Artists page, which has no item, uses the lookup
// alone. Never apply it to `uploader`, which is not an artist.
// Display only — search, sort and dialogs keep using real names.
export function maskArtistName(
  artistId: number | null | undefined,
  name: string,
  revealed: boolean,
  privacyEnabled: boolean | undefined,
  privateIds: ReadonlySet<number> | undefined,
): string {
  if (revealed || privacyEnabled === false) return name
  if (privateIds && (artistId == null || !privateIds.has(artistId))) return name
  return hashText(name)
}

export function useArtistNameMask(): (artistId: number | null | undefined, name: string, revealed: boolean) => string {
  const { data: settings } = useSettings()
  const { data: artists } = useArtists()
  const privacyEnabled = settings?.privacyEnabled
  // Built once per artists list (undefined while not loaded), not per call.
  const privateIds = useMemo(() => (artists ? new Set(artists.filter((a) => a.isPrivate).map((a) => a.id)) : undefined), [artists])
  return useCallback(
    (artistId, name, revealed) => maskArtistName(artistId, name, revealed, privacyEnabled, privateIds),
    [privacyEnabled, privateIds],
  )
}

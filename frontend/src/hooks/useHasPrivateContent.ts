import { useArtists } from "@/hooks/useArtists"
import { useCollections } from "@/hooks/useCollections"
import { useSettings } from "@/hooks/useSettings"
import { useTags } from "@/hooks/useTags"

// Whether anything in the library is currently blurred — privacy is on and
// either a whole collection (itself or an inherited ancestor) is private and
// has at least one item somewhere under it, using the inheritance-aware
// effectiveIsPrivate/totalItemCount fields (a private *parent* used purely
// for organization has itemCount 0 of its own, with its items living in a
// non-private child that only inherits — the raw isPrivate/itemCount alone
// would always read as "nothing blurred" in that normal nested-collection
// setup) — or a private tag is applied to at least one item, independent
// of any collection (backend's blurred computation ORs both sources
// together; this needs to match, or a lone private-tagged item in an
// otherwise-public collection would have no way to be revealed) — or any
// artist is private (its Artists page panel images are blurred).
export function useHasPrivateContent() {
  const { data: settings } = useSettings()
  const { data: collections } = useCollections()
  const { data: allTags } = useTags()
  const { data: artists } = useArtists()
  return (
    !!settings?.privacyEnabled &&
    ((collections ?? []).some((c) => c.effectiveIsPrivate && c.totalItemCount > 0) ||
      (allTags ?? []).some((t) => t.isPrivate && t.usageCount > 0) ||
      (artists ?? []).some((a) => a.isPrivate))
  )
}

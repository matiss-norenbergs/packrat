import { useEffect } from "react"
import { ImageIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { BlurredThumbnail } from "@/components/BlurredThumbnail"
import { useRevealAll } from "@/components/library/RevealAllContext"
import { useArtists } from "@/hooks/useArtists"
import { useCollections } from "@/hooks/useCollections"
import { useSettings } from "@/hooks/useSettings"
import { collectionMediumCoverUrl } from "@/lib/api"
import { nearestPrivateAncestor } from "@/lib/collectionTree"
import { collectionRevealKey } from "@/lib/revealKeys"
import { cn } from "@/lib/utils"
import type { Collection } from "@/types/api"

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s
}

// Every detail here already exists on the Collection object the tree's own
// query fetches — no extra request needed just to populate this panel,
// unlike the Artists page's image gallery.
export function CollectionInfoPanel({
  collection,
  selectedCount,
}: {
  collection?: Collection
  selectedCount: number
}) {
  const { data: settings } = useSettings()
  const { data: artists } = useArtists()
  const { data: collections } = useCollections()
  const { isRevealed, toggleItem, hideItem } = useRevealAll()

  // The panel is a single focused view, so a cover revealed by click lasts
  // only while that collection stays selected: the cleanup runs when the
  // selection moves on (or empties) and when the panel closes. Reveal-all is
  // untouched. Harmless under StrictMode's extra mount/cleanup (nothing is
  // revealed yet).
  const panelKey = collection ? collectionRevealKey(collection.id) : null
  useEffect(() => {
    if (panelKey == null) return
    return () => hideItem(panelKey)
  }, [panelKey, hideItem])

  if (!collection) {
    return (
      <p className="text-sm text-muted-foreground">
        {selectedCount > 1 ? `${selectedCount} collections selected.` : "Select a collection to see its details."}
      </p>
    )
  }

  const artistName = collection.artistId != null ? artists?.find((a) => a.id === collection.artistId)?.name : undefined
  const coverUrl = collectionMediumCoverUrl(collection)
  // The master privacy switch (Settings) disables every blur app-wide even
  // when a collection's own Private flag is still set underneath — same
  // gating the rest of the app uses. Privacy inherits down the tree, so the
  // cover blurs on effectiveIsPrivate (own flag or any private ancestor).
  const privacyOn = !!settings?.privacyEnabled
  const isBlurred = privacyOn && collection.effectiveIsPrivate
  const privateAncestor =
    privacyOn && !collection.isPrivate && collection.effectiveIsPrivate
      ? nearestPrivateAncestor(collections ?? [], collection.id)
      : null
  const revealKey = collectionRevealKey(collection.id)
  const gaps = collection.sequenceGaps

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-2 truncate text-sm font-medium">{collection.name}</h2>
        <div className="aspect-video w-full overflow-hidden rounded-md border bg-muted">
          {coverUrl ? (
            <BlurredThumbnail
              src={coverUrl}
              blurred={isBlurred}
              revealed={isRevealed(revealKey)}
              onToggleReveal={() => toggleItem(revealKey)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageIcon className="h-12 w-12 text-muted-foreground/40" />
            </div>
          )}
        </div>
      </div>

      <dl className="space-y-2 text-sm">
        <InfoRow label="Path" value={collection.path} mono />
        <InfoRow label="Folder" value={collection.rootPath} mono />
        <InfoRow label="Type" value={capitalize(collection.defaultDownloadType)} />
        <InfoRow label="Quality" value={capitalize(collection.defaultQuality)} />
        <PrivateRow
          own={privacyOn && collection.isPrivate}
          inherited={privacyOn && !collection.isPrivate && collection.effectiveIsPrivate}
          ancestorName={privateAncestor?.name}
        />
        <BadgeRow label="Show as single item in Browse" value={collection.browseAsShow} />
        <InfoRow label="Artist" value={artistName} />
        <InfoRow label="Year" value={collection.year != null ? String(collection.year) : undefined} />
        <InfoRow label="Season #" value={collection.seasonNumber != null ? String(collection.seasonNumber) : undefined} />
        <InfoRow
          label="Sequence range"
          value={
            collection.sequenceMin != null || collection.sequenceMax != null
              ? `${collection.sequenceMin ?? "—"} – ${collection.sequenceMax ?? "—"}`
              : undefined
          }
        />
        <InfoRow label="Filename Template" value={collection.filenameTemplate || undefined} mono />
        {settings?.jellyfinEnabled && (
          <InfoRow label="Jellyfin Library ID" value={collection.jellyfinLibraryId ?? undefined} mono />
        )}
        <InfoRow
          label="Items"
          value={`${collection.itemCount}${collection.ghostItemCount > 0 ? ` (${collection.ghostItemCount} ghost)` : ""}`}
        />
        {collection.totalItemCount !== collection.itemCount && (
          <InfoRow
            label="Items (incl. sub-collections)"
            value={`${collection.totalItemCount}${
              collection.totalGhostItemCount > 0 ? ` (${collection.totalGhostItemCount} ghost)` : ""
            }`}
          />
        )}
        {gaps && (
          <InfoRow
            label="Sequence gaps"
            value={`missing ${gaps.missing.join(", ")} (of ${gaps.min}–${gaps.max})`}
          />
        )}
      </dl>
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 truncate text-right", mono && "font-mono text-xs")}>{value || "—"}</dd>
    </div>
  )
}

// Yes stands out in green so the affirmative case reads at a glance; No stays
// a plain neutral badge — it isn't a warning, just the other half of the
// same yes/no field.
function BadgeRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd>
        <Badge
          variant="outline"
          className={
            value
              ? "border-green-600/30 bg-green-500/10 text-green-700 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-400"
              : undefined
          }
        >
          {value ? "Yes" : "No"}
        </Badge>
      </dd>
    </div>
  )
}

// Own flag -> Yes; only inherited from an ancestor -> a neutral "Inherited"
// badge whose tooltip names the nearest private ancestor; neither -> No.
function PrivateRow({ own, inherited, ancestorName }: { own: boolean; inherited: boolean; ancestorName?: string }) {
  if (!inherited) return <BadgeRow label="Private" value={own} />
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-muted-foreground">Private</dt>
      <dd>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Badge variant="secondary">Inherited</Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent>{ancestorName ? `Inherited from ${ancestorName}` : "Inherited from a private parent"}</TooltipContent>
        </Tooltip>
      </dd>
    </div>
  )
}

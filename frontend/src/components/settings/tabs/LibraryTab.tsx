import { Gauge, Image as ImageIcon, Play, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ResolutionTierSlider } from "@/components/ResolutionTierSlider"
import { ThumbnailFrameRangeSlider } from "@/components/ThumbnailFrameRangeSlider"
import { RESOLUTION_STEP_LABELS } from "@/lib/resolution"
import { FieldLabel, InfoPopover } from "@/components/ui/info-popover"
import { SettingsCard } from "@/components/settings/SettingsCard"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StrayFilesRow } from "@/components/settings/StrayFilesRow"
import { useScanMissingLibraryFiles } from "@/hooks/useLibrary"
import { useImageBackfillStatus, useStartImageBackfill, useUpdateSettings } from "@/hooks/useSettings"
import type { Settings, UpdateSettingsRequest } from "@/types/api"
import { SaveRow } from "@/components/settings/SaveRow"
import { SettingsTabLoader } from "@/components/settings/SettingsTabLoader"
import { useSettingsDraft } from "@/hooks/useSettingsDraft"

const FRAME_COUNT_OPTIONS = [2, 4, 6, 8, 12, 24]

function toForm(s: Settings) {
  return {
    mediumEnabled: s.resolutionTierMediumEnabled,
    low: s.resolutionThresholdLow,
    high: s.resolutionThresholdHigh,
    thumbMediumEnabled: s.thumbnailResolutionTierMediumEnabled,
    thumbLow: s.thumbnailResolutionThresholdLow,
    thumbHigh: s.thumbnailResolutionThresholdHigh,
    frameCount: s.thumbnailFrameCount,
    frameRangeLow: s.thumbnailFrameRangeLow,
    frameRangeHigh: s.thumbnailFrameRangeHigh,
    autoplay: s.libraryAutoplay,
  }
}

export function LibraryTab() {
  return (
    <SettingsTabLoader skeletonClassName="h-40 w-full max-w-lg">
      {(settings) => <LibraryTabBody settings={settings} />}
    </SettingsTabLoader>
  )
}

function LibraryTabBody({ settings }: { settings: Settings }) {
  const updateSettings = useUpdateSettings()
  const { data: backfillStatus } = useImageBackfillStatus()
  const startBackfill = useStartImageBackfill()
  const scanMissing = useScanMissingLibraryFiles()
  const { field, afterSave } = useSettingsDraft(settings, toForm)
  const [mediumEnabled, setMediumEnabled] = field("mediumEnabled")
  const [low, setLow] = field("low")
  const [high, setHigh] = field("high")
  const [thumbMediumEnabled, setThumbMediumEnabled] = field("thumbMediumEnabled")
  const [thumbLow, setThumbLow] = field("thumbLow")
  const [thumbHigh, setThumbHigh] = field("thumbHigh")
  const [frameCount, setFrameCount] = field("frameCount")
  const [frameRangeLow, setFrameRangeLow] = field("frameRangeLow")
  const [frameRangeHigh, setFrameRangeHigh] = field("frameRangeHigh")
  const [autoplay, setAutoplay] = field("autoplay")

  const payload: UpdateSettingsRequest = {}
  if (mediumEnabled !== settings.resolutionTierMediumEnabled) payload.resolutionTierMediumEnabled = mediumEnabled
  if (low !== settings.resolutionThresholdLow) payload.resolutionThresholdLow = low
  if (high !== settings.resolutionThresholdHigh) payload.resolutionThresholdHigh = high
  if (thumbMediumEnabled !== settings.thumbnailResolutionTierMediumEnabled)
    payload.thumbnailResolutionTierMediumEnabled = thumbMediumEnabled
  if (thumbLow !== settings.thumbnailResolutionThresholdLow) payload.thumbnailResolutionThresholdLow = thumbLow
  if (thumbHigh !== settings.thumbnailResolutionThresholdHigh) payload.thumbnailResolutionThresholdHigh = thumbHigh
  if (frameCount !== settings.thumbnailFrameCount) payload.thumbnailFrameCount = frameCount
  if (frameRangeLow !== settings.thumbnailFrameRangeLow) payload.thumbnailFrameRangeLow = frameRangeLow
  if (frameRangeHigh !== settings.thumbnailFrameRangeHigh) payload.thumbnailFrameRangeHigh = frameRangeHigh
  if (autoplay !== settings.libraryAutoplay) payload.libraryAutoplay = autoplay
  const dirty = Object.keys(payload).length > 0

  const lowLabel = RESOLUTION_STEP_LABELS[low] ?? `${low}p`
  const highLabel = RESOLUTION_STEP_LABELS[high] ?? `${high}p`
  const thumbLowLabel = RESOLUTION_STEP_LABELS[thumbLow] ?? `${thumbLow}p`
  const thumbHighLabel = RESOLUTION_STEP_LABELS[thumbHigh] ?? `${thumbHigh}p`

  return (
    <div className="flex min-h-full flex-col">
      <div className="max-w-3xl space-y-6 pb-6">
        <SettingsCard icon={Play} title="Player">
          <div className="flex items-center gap-1.5">
            <Checkbox id="library-autoplay" checked={autoplay} onCheckedChange={(v) => setAutoplay(v === true)} />
            <Label htmlFor="library-autoplay" className="font-normal">
              Autoplay
            </Label>
            <InfoPopover>
              Starts playback immediately when opening a library item — including a private one,
              right after you reveal it. Volume is remembered automatically between plays.
            </InfoPopover>
          </div>
        </SettingsCard>

        <SettingsCard icon={Gauge} title="Resolution tiers">
          <div className="max-w-lg space-y-4">
            <div className="flex items-center gap-1.5">
              <Checkbox id="resolution-medium-enabled" checked={mediumEnabled} onCheckedChange={(v) => setMediumEnabled(v === true)} />
              <Label htmlFor="resolution-medium-enabled" className="font-normal">
                Use medium tier
              </Label>
              <InfoPopover>
                When off, resolution is split into just low/high. The medium threshold is kept
                (not discarded) so turning this back on restores it.
              </InfoPopover>
            </div>

            <div className="space-y-1.5">
              <FieldLabel
                htmlFor="resolution-tier-slider"
                info="Colors the Resolution value in Library's Details mode, Compare Metadata, and the New Download preview according to which tier a file's resolution falls into."
              >
                Quality tiers
              </FieldLabel>
              <ResolutionTierSlider
                mediumEnabled={mediumEnabled}
                low={low}
                high={high}
                onCommit={(newLow, newHigh) => {
                  setLow(newLow)
                  setHigh(newHigh)
                }}
              />
              <p className="text-xs text-muted-foreground">
                {mediumEnabled
                  ? `Low: ≤${lowLabel} · Medium: ${lowLabel}–${highLabel} · High: ≥${highLabel}`
                  : `Low: <${highLabel} · High: ≥${highLabel}`}
              </p>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard icon={ImageIcon} title="Thumbnails">
          <div className="max-w-lg space-y-4">
            <div className="space-y-2">
              <FieldLabel
                htmlFor="thumbnail-frame-count"
                info="How many frame options to offer when picking a thumbnail from a video."
              >
                "Choose from Video" frame count
              </FieldLabel>
              <Select value={String(frameCount)} onValueChange={(v) => setFrameCount(Number(v))}>
                <SelectTrigger id="thumbnail-frame-count" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FRAME_COUNT_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <FieldLabel
                htmlFor="thumbnail-frame-range-slider"
                info="Which portion of the video, by duration, candidate frames are picked from. Narrowing this away from the default skips more of the intro/outro; the low end defaults to 5% to avoid a likely-blank opening frame."
              >
                "Choose from Video" pick range
              </FieldLabel>
              <ThumbnailFrameRangeSlider
                low={frameRangeLow}
                high={frameRangeHigh}
                onCommit={(newLow, newHigh) => {
                  setFrameRangeLow(newLow)
                  setFrameRangeHigh(newHigh)
                }}
              />
              <p className="text-xs text-muted-foreground">
                {frameRangeLow}% – {frameRangeHigh}% of the video's duration
              </p>
            </div>

            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center gap-1.5">
                <Checkbox
                  id="thumbnail-resolution-medium-enabled"
                  checked={thumbMediumEnabled}
                  onCheckedChange={(v) => setThumbMediumEnabled(v === true)}
                />
                <Label htmlFor="thumbnail-resolution-medium-enabled" className="font-normal">
                  Use medium tier
                </Label>
                <InfoPopover>
                  When off, thumbnail resolution is split into just low/high. The medium threshold
                  is kept (not discarded) so turning this back on restores it.
                </InfoPopover>
              </div>

              <div className="space-y-1.5">
                <FieldLabel
                  htmlFor="thumbnail-resolution-tier-slider"
                  info="Colors the Thumbnail resolution value in Library's Details mode according to which tier a thumbnail's resolution falls into. Separate from the video tiers above — thumbnails rarely exceed 1080p, so the defaults are lower."
                >
                  Thumbnail quality tiers
                </FieldLabel>
                <ResolutionTierSlider
                  mediumEnabled={thumbMediumEnabled}
                  low={thumbLow}
                  high={thumbHigh}
                  onCommit={(newLow, newHigh) => {
                    setThumbLow(newLow)
                    setThumbHigh(newHigh)
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {thumbMediumEnabled
                    ? `Low: ≤${thumbLowLabel} · Medium: ${thumbLowLabel}–${thumbHighLabel} · High: ≥${thumbHighLabel}`
                    : `Low: <${thumbHighLabel} · High: ≥${thumbHighLabel}`}
                </p>
              </div>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard
          icon={Wrench}
          title="Library maintenance"
          description="These run immediately and are not part of Save."
        >
          <div className="max-w-lg space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label>Image derivatives</Label>
                <InfoPopover>
                  Generates small/medium-size versions of library thumbnails, artist images, and
                  collection covers, so most of the app loads a much smaller file instead of the
                  original. Only needed once for items that predate this feature (or after resetting
                  the images folder) — anything downloaded or edited afterward gets this
                  automatically. Independent of the other settings — runs immediately, not part of
                  Save.
                </InfoPopover>
              </div>
              {backfillStatus?.running ? (
                <p className="text-sm text-muted-foreground">
                  Running… library {backfillStatus.libraryProcessed} processed
                  {backfillStatus.libraryFailed > 0 ? ` (${backfillStatus.libraryFailed} failed)` : ""}, artists{" "}
                  {backfillStatus.artistProcessed} processed
                  {backfillStatus.artistFailed > 0 ? ` (${backfillStatus.artistFailed} failed)` : ""}, covers{" "}
                  {backfillStatus.coverProcessed} processed
                  {backfillStatus.coverFailed > 0 ? ` (${backfillStatus.coverFailed} failed)` : ""}.
                </p>
              ) : backfillStatus?.finishedAt ? (
                <p className="text-sm text-muted-foreground">
                  Last run: library {backfillStatus.libraryProcessed}/{backfillStatus.libraryFailed} failed, artists{" "}
                  {backfillStatus.artistProcessed}/{backfillStatus.artistFailed} failed, covers{" "}
                  {backfillStatus.coverProcessed}/{backfillStatus.coverFailed} failed.
                </p>
              ) : null}
              <Button
                variant="outline"
                onClick={() => startBackfill.mutate()}
                disabled={startBackfill.isPending || backfillStatus?.running}
              >
                {backfillStatus?.running ? "Running…" : "Backfill Images"}
              </Button>
            </div>

            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center gap-1.5">
                <Label>Missing and stray files</Label>
                <InfoPopover>
                  Checks every non-ghost item's file against disk and converts any that are missing
                  (deleted, moved, or renamed outside the app) into ghost placeholders — the DB row,
                  tags, and metadata are kept, "Download now" fills it back in. On-demand only, not
                  scheduled. "Find Stray Files" is the inverse: it lists files on disk that no database
                  record references (leftover thumbnails, orphaned sidecars, abandoned temp files) so you
                  can review and delete them.
                </InfoPopover>
              </div>
              <Button variant="outline" onClick={() => scanMissing.mutate()} disabled={scanMissing.isPending}>
                {scanMissing.isPending ? "Scanning…" : "Scan for Missing Files"}
              </Button>
              <StrayFilesRow />
            </div>
          </div>
        </SettingsCard>
      </div>
      <SaveRow
        dirty={dirty}
        isPending={updateSettings.isPending}
        isSuccess={updateSettings.isSuccess}
        onSave={() => updateSettings.mutate(payload, { onSuccess: afterSave })}
      />
    </div>
  )
}

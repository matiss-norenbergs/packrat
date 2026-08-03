import type { Settings } from "@/types/api"

// Standard resolution heights the tier slider snaps to — also what the
// backend's UpdateSettingsRequest thresholds are constrained to
// (binding:"omitempty,oneof=480 720 1080 1440 2160 4320").
export const RESOLUTION_STEPS = [480, 720, 1080, 1440, 2160, 4320] as const

export const RESOLUTION_STEP_LABELS: Record<number, string> = {
  480: "480p",
  720: "720p",
  1080: "1080p",
  1440: "1440p",
  2160: "4K",
  4320: "8K",
}

export type ResolutionTier = "low" | "medium" | "high"

export const RESOLUTION_TIER_CLASS: Record<ResolutionTier, string> = {
  low: "text-red-600 dark:text-red-500",
  medium: "text-yellow-600 dark:text-yellow-500",
  high: "text-green-600 dark:text-green-500",
}

// Resolution is stored/displayed everywhere as a raw "WIDTHxHEIGHT" string
// (see backend/internal/importer/probe.go's fmt.Sprintf("%dx%d", ...)) —
// this pulls out the height, since tiers threshold on that regardless of
// orientation (a portrait video's larger number is still "height" as far as
// the rest of the app is concerned).
export function parseResolutionHeight(resolution: string | null | undefined): number | null {
  if (!resolution) return null
  const parts = resolution.split("x")
  if (parts.length !== 2) return null
  const height = Number(parts[1])
  return Number.isFinite(height) && height > 0 ? height : null
}

type TierSettings = Pick<Settings, "resolutionTierMediumEnabled" | "resolutionThresholdLow" | "resolutionThresholdHigh">

export function getResolutionTier(
  resolution: string | null | undefined,
  settings: TierSettings | null | undefined,
): ResolutionTier | null {
  const height = parseResolutionHeight(resolution)
  if (height == null || !settings) return null

  if (height >= settings.resolutionThresholdHigh) return "high"
  if (!settings.resolutionTierMediumEnabled) return "low"
  if (height <= settings.resolutionThresholdLow) return "low"
  return "medium"
}

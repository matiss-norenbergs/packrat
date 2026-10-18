import { useSettings } from "./useSettings"

// The optional features (Settings → Features). Each defaults to on.
export type FeatureKey =
  | "featureSubscriptionsEnabled"
  | "featureFrameMatchingEnabled"
  | "featureCompareListEnabled"
  | "featureFileImportEnabled"

// Unlike requiresSetting's opt-in features (AI Enhancement), these are on
// unless the user turned them off, so a feature only counts as disabled once
// settings have loaded and say so — never while loading or on a failed fetch.
export function useFeatureEnabled(key: FeatureKey): boolean {
  const { data } = useSettings()
  return data?.[key] !== false
}

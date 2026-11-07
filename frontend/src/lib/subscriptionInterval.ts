// Allowed subscription check interval, mirrored from the backend
// (subscriptions.MinCheckIntervalHours / MaxCheckIntervalHours). The form only
// offers fixed options inside this range; clampIntervalHours exists so a value
// already stored out of range (from before the backend validated it) is never
// echoed back unchanged — e.g. by the Enabled switch — and rejected with a 400.
export const MIN_CHECK_INTERVAL_HOURS = 1
export const MAX_CHECK_INTERVAL_HOURS = 8760

export function clampIntervalHours(hours: number): number {
  if (!Number.isFinite(hours)) return MIN_CHECK_INTERVAL_HOURS
  return Math.min(MAX_CHECK_INTERVAL_HOURS, Math.max(MIN_CHECK_INTERVAL_HOURS, Math.trunc(hours)))
}

// Dashboard blocks that can be shown/hidden. IDs are persisted in the
// dashboardHiddenWidgets setting and validated by the backend allowlist
// (dashboardWidgetIDs in settings_handler.go) — keep the two in sync.
export const DASHBOARD_WIDGETS = [
  { id: "downloads", label: "Downloads" },
  { id: "library", label: "Library" },
  { id: "libraryGrowth", label: "Library Growth" },
  { id: "mediaTypes", label: "Media Types" },
  { id: "resolutions", label: "Items by Resolution" },
  { id: "storage", label: "Storage" },
  { id: "topArtists", label: "Top Artists" },
  { id: "topTags", label: "Top Tags" },
] as const

export type DashboardWidgetId = (typeof DASHBOARD_WIDGETS)[number]["id"]

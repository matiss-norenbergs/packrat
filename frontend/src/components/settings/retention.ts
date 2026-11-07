export const RETENTION_OPTIONS: { value: string; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "365 days" },
  { value: "0", label: "Forever" },
]

// "Keep the last" for the system log; 0 = Unlimited (never pruned).
export const SYSTEM_EVENT_COUNT_OPTIONS: { value: string; label: string }[] = [
  { value: "500", label: "500 events" },
  { value: "1000", label: "1,000 events" },
  { value: "5000", label: "5,000 events" },
  { value: "10000", label: "10,000 events" },
  { value: "0", label: "Unlimited" },
]

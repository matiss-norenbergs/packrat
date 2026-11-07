// Badge variant per system-log level: info is neutral, warning and error use the status tokens.
export const SYSTEM_EVENT_LEVEL_VARIANT: Record<string, "secondary" | "warning" | "destructive"> = {
  info: "secondary",
  warning: "warning",
  error: "destructive",
}

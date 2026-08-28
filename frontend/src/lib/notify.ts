import { toast } from "sonner"

// Whether desktop notifications are turned on — a personal per-browser
// preference (Notification permission itself is granted per-browser/per-
// device anyway), not something that needs a backend Settings round-trip.
// Same storage pattern as useAccentColor.
const STORAGE_KEY = "packrat-desktop-notifications"

export function isDesktopNotificationsEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true"
}

export function setDesktopNotificationsEnabled(next: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(next))
}

// Requests permission only if it hasn't been decided yet — re-prompting
// after an explicit "denied" is up to the user via their browser's own site
// settings, not something we can trigger again ourselves.
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false
  if (Notification.permission === "granted") return true
  if (Notification.permission === "denied") return false
  return (await Notification.requestPermission()) === "granted"
}

function notify(title: string, body?: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return
  new Notification(title, { body, icon: "/favicon.svg" })
}

// Whether the underlying setting/away-from-tab gate that governs a desktop
// notification is currently open — shared by notifyEvent (below) and
// notifyEventAsync, so the latter can skip its resolveBody() call entirely
// (e.g. no need to fetch a library item's privacy status) when nothing
// would end up shown anyway.
function desktopNotifyGateOpen(): boolean {
  return isDesktopNotificationsEnabled() && isAwayFromTab()
}

// The toast already covers "user is looking at this tab" — a desktop
// notification only earns its place when they're not: tab backgrounded/
// minimized (document.hidden), or visible but the window itself isn't
// focused (e.g. working in another window on a second monitor — hidden
// alone misses this, since visibilityState stays "visible").
function isAwayFromTab(): boolean {
  return document.hidden || !document.hasFocus()
}

// Single call site for "tell the user something happened" — always shows
// the toast; additionally fires a desktop notification when this particular
// event is marked desktop-worthy (a per-call-site decision, e.g. true for a
// download finishing, false for routine progress), the user has desktop
// notifications turned on, and they're away from the tab. Keeping toast and
// desktop-notify together avoids every WS event handler repeating its own
// isDesktopNotificationsEnabled()/isAwayFromTab() checks.
export function notifyEvent(
  variant: "success" | "error" | "info",
  title: string,
  body: string | undefined,
  desktopWorthy: boolean,
) {
  toast[variant](body ? `${title}: ${body}` : title)
  if (desktopWorthy && desktopNotifyGateOpen()) {
    notify(title, body)
  }
}

// Fires only the desktop notification (no toast) — for an event with no
// privacy-sensitive body to resolve first (contrast notifyDesktopAsync).
export function notifyDesktop(title: string, body?: string) {
  if (!desktopNotifyGateOpen()) return
  notify(title, body)
}

// Fires only the desktop notification (no toast) once resolveBody resolves
// — for events that don't get a toast at all today (AI Enhancement/Frame
// Matching already have their own live per-item status in their own pages,
// so a toast per item would just be noise on top of that), but are still
// desktop-notification-worthy for someone away from the tab. resolveBody is
// only called at all if the desktop-notify gate is actually open, so a user
// with notifications off — or who's currently looking at the tab — never
// triggers the extra fetch (e.g. a library item's privacy status).
export function notifyDesktopAsync(title: string, resolveBody: () => Promise<string | undefined>) {
  if (!desktopNotifyGateOpen()) return
  resolveBody()
    .then((body) => notify(title, body))
    .catch(() => {
      // Best-effort — skip the notification rather than risk showing an
      // unresolved/incorrect body if the privacy check itself failed.
    })
}

// Async sibling of notifyEvent, for when the desktop notification's body
// isn't known synchronously — e.g. a download's title shouldn't appear in
// an OS notification if the resulting library item turns out to be private,
// which needs a fetch to find out. The toast still shows immediately with
// the body the caller already has (a toast is only ever visible to whoever
// is already looking at this tab, so it isn't subject to the same
// privacy-leak concern an OS notification/lock-screen is).
export function notifyEventAsync(
  variant: "success" | "error" | "info",
  title: string,
  toastBody: string | undefined,
  resolveDesktopBody: () => Promise<string | undefined>,
) {
  toast[variant](toastBody ? `${title}: ${toastBody}` : title)
  notifyDesktopAsync(title, resolveDesktopBody)
}

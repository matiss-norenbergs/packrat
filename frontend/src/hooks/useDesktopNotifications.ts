import { useState } from "react"
import { toast } from "sonner"
import {
  ensureNotificationPermission,
  isDesktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
} from "@/lib/notify"

// Client-side only, same as accent color / theme — see notify.ts for why
// this isn't a backend Settings field.
export function useDesktopNotifications() {
  const [enabled, setEnabledState] = useState(isDesktopNotificationsEnabled)

  async function setEnabled(next: boolean) {
    if (next) {
      const granted = await ensureNotificationPermission()
      if (!granted) {
        toast.error("Desktop notifications need permission — check your browser's site settings.")
        return
      }
    }
    setDesktopNotificationsEnabled(next)
    setEnabledState(next)
  }

  return { enabled, setEnabled }
}

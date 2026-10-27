import { Bell } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { InfoPopover } from "@/components/ui/info-popover"
import { SettingsCard } from "@/components/settings/SettingsCard"
import { Label } from "@/components/ui/label"
import { useDesktopNotifications } from "@/hooks/useDesktopNotifications"

// Its own tab (rather than living under Downloads, where it started) since
// desktop notifications aren't download-specific — the same toggle governs
// any future notification-worthy event, not just a download finishing.
export function NotificationsTab() {
  const { enabled: desktopNotifications, setEnabled: setDesktopNotifications } = useDesktopNotifications()

  return (
    <div className="max-w-3xl space-y-6">
      <SettingsCard
        icon={Bell}
        title="Desktop notifications"
        description="A personal preference stored on this device only."
      >
        <div className="max-w-lg space-y-4">
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="desktop-notifications"
              checked={desktopNotifications}
              onCheckedChange={(v) => setDesktopNotifications(v === true)}
            />
            <Label htmlFor="desktop-notifications" className="font-normal">
              Desktop notifications
            </Label>
            <InfoPopover>
              Shows a browser/OS notification for notification-worthy events (currently: a download
              completing/failing/being cancelled, a thumbnail finishing AI Enhancement, a Frame Match
              being found, a scheduled subscription check finding new items, or a scheduled backup
              failing) — on top of the in-app toast, which always shows regardless of this setting
              for downloads (the rest skip the toast and use only the desktop notification — either
              because they already show live status on their own page, like Enhancement/Frame Match,
              or because a manual trigger of the same action already gets synchronous feedback, like
              "Check now"/a manual backup). Only fires while you're away from this tab (it's
              backgrounded, minimized, or the window isn't focused) — the toast already covers the
              case where you're looking at it. A personal per-browser preference (like Theme), not
              synced across devices. Turning this on prompts for
              notification permission if you haven't granted or denied it yet.
            </InfoPopover>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}

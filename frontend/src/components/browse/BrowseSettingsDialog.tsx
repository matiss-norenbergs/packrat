import { RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useBrowsePrefs } from "@/hooks/useBrowsePrefs"
import { useDesktopAppVersion } from "@/hooks/useDesktopAppVersion"
import { useAppVersion } from "@/hooks/useSettings"

// The Android app's Settings (Browse-only mode; opened from BrowseAppMenu). Fullscreen on any
// screen; the native shell already pads the page for the system bars. Each switch shows the
// effective value: this device's override if one is set, else the server's setting. Toggling sets
// the override (localStorage, see useBrowsePrefs); nothing here writes to the server.
export function BrowseSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="inset-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 ring-0 sm:max-w-none"
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5">
          <DialogTitle className="flex-1 text-lg font-semibold">Settings</DialogTitle>
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="icon" className="size-11" aria-label="Close">
              <X className="h-5 w-5" />
            </Button>
          </DialogClose>
        </div>
        <DialogDescription className="sr-only">
          Playback and privacy preferences for this device, and the app and server versions.
        </DialogDescription>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <BrowseSettingsBody />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BrowseSettingsBody() {
  const prefs = useBrowsePrefs()
  return (
    <div className="mx-auto w-full max-w-xl divide-y px-4">
      <PrefRow
        id="browse-pref-autoplay"
        label="Autoplay"
        description="Start playing a video as soon as it opens."
        checked={prefs.autoplay}
        overridden={prefs.autoplayOverridden}
        onCheckedChange={prefs.setAutoplay}
        onReset={prefs.resetAutoplay}
      />
      <PrefRow
        id="browse-pref-blur"
        label="Blur private items"
        description="Blur thumbnails and covers of private items until you tap to reveal them."
        checked={prefs.blurPrivate}
        overridden={prefs.blurPrivateOverridden}
        onCheckedChange={prefs.setBlurPrivate}
        onReset={prefs.resetBlurPrivate}
      />
      <VersionRow />
    </div>
  )
}

function PrefRow({
  id,
  label,
  description,
  checked,
  overridden,
  onCheckedChange,
  onReset,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  overridden: boolean
  onCheckedChange: (value: boolean) => void
  onReset: () => void
}) {
  const hintId = `${id}-hint`
  return (
    <section className="py-4">
      <div className="flex items-center gap-4">
        <Label htmlFor={id} className="min-w-0 flex-1 flex-col items-start gap-1 py-1 leading-snug">
          <span className="text-base font-medium">{label}</span>
          <span className="text-sm font-normal text-muted-foreground">{description}</span>
        </Label>
        <div className="flex size-11 shrink-0 items-center justify-center">
          <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-describedby={hintId} />
        </div>
      </div>
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        <span id={hintId}>{overridden ? "Set on this device" : "Following the server setting"}</span>
        {overridden && (
          <Button type="button" variant="link" size="sm" className="h-11 px-0 text-xs" onClick={onReset}>
            <RotateCcw className="h-3.5 w-3.5" />
            Use server setting
          </Button>
        )}
      </div>
    </section>
  )
}

const formatVersion = (v: string) => (/^\d/.test(v) ? `v${v}` : v)

function VersionRow() {
  const app = useDesktopAppVersion()
  const server = useAppVersion()
  const serverText = server.data?.version
    ? formatVersion(server.data.version)
    : server.isLoading
      ? "Loading…"
      : "Unavailable"
  return (
    <section className="space-y-2 py-4">
      <h3 className="text-base font-medium">App version</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">App</dt>
        <dd>{app ? formatVersion(app) : "Unavailable"}</dd>
        <dt className="text-muted-foreground">Server</dt>
        <dd>{serverText}</dd>
      </dl>
    </section>
  )
}

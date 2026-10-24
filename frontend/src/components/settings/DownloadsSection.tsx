import { FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InfoPopover } from "@/components/ui/info-popover"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useAskWhereToSave } from "@/hooks/useAskWhereToSave"
import { useDownloadFolder } from "@/hooks/useDownloadFolder"

// Settings → Desktop → Downloads: where files the app downloads (e.g. backups) are saved. Both
// settings live in the shell (desktop.json), which reads them when a download starts.
export function DownloadsSection() {
  const { enabled: ask, setEnabled: setAsk } = useAskWhereToSave()
  const { folder, choose, reset } = useDownloadFolder()

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Downloads</h3>
      <div className="flex items-center gap-2">
        <Switch id="ask-where-to-save" checked={ask === true} disabled={ask === null} onCheckedChange={setAsk} />
        <Label htmlFor="ask-where-to-save" className="font-normal">
          Ask where to save each download
        </Label>
        <InfoPopover>
          Opens your system's Save dialog for every download, with the file name filled in and starting in
          the folder you last saved to. The file is fetched first and the dialog appears once it's
          complete; cancelling it discards the file. Off by default: downloads go straight to the folder
          below.
        </InfoPopover>
      </div>
      <div className="space-y-1.5">
        <Label>Save to</Label>
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-1.5 font-mono text-xs"
            title={folder?.path}
          >
            {folder?.path ?? "…"}
          </span>
          <Button size="sm" variant="outline" onClick={choose} disabled={folder === null}>
            <FolderOpen className="h-4 w-4" />
            Change…
          </Button>
          {folder && !folder.isDefault && (
            <Button size="sm" variant="ghost" onClick={reset}>
              Use default
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {folder?.isDefault !== false ? "Your system's Downloads folder. " : ""}A file with the same
          name is never overwritten: it gets a number added.
          {ask === true && " With the Save dialog on, this is only where it starts the first time."}
        </p>
      </div>
    </div>
  )
}

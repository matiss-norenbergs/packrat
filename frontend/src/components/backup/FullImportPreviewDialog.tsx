import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useImportFullBackup } from "@/hooks/useBackup"
import type { FullImportPreview, LibraryImportMode } from "@/types/api"
import { PreviewItemList } from "./PreviewItemList"

interface FullImportPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  preview: FullImportPreview | null
  data: string
  password: string
  mode: LibraryImportMode
  onModeChange: (mode: LibraryImportMode) => void
  onImported: () => void
}

// Full-backup sibling to LibraryImportPreviewDialog — same shape, plus a
// settings-entry count above the library diff (settings always overwrite
// every key, so there's nothing to diff there). The mode picker lives here,
// not on the page — "Import Now" is the actual commit.
export function FullImportPreviewDialog({
  open,
  onOpenChange,
  preview,
  data,
  password,
  mode,
  onModeChange,
  onImported,
}: FullImportPreviewDialogProps) {
  const importMutation = useImportFullBackup()

  if (!preview) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Import preview</DialogTitle>
          <DialogDescription>What this file contains, before you commit to importing it.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="full-preview-mode">Library items with a saved URL</Label>
          <Select value={mode} onValueChange={(v) => onModeChange(v as LibraryImportMode)}>
            <SelectTrigger id="full-preview-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="download">Import and download</SelectItem>
              <SelectItem value="ghostOnly">Import as ghost items</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{preview.settingsCount}</span> settings entries — always
          overwrite the current values.
        </p>

        <PreviewItemList preview={preview.library} mode={mode} />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={() =>
              importMutation.mutate(
                { data, password, mode },
                {
                  onSuccess: () => {
                    onOpenChange(false)
                    onImported()
                  },
                },
              )
            }
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? "Importing…" : "Import Now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

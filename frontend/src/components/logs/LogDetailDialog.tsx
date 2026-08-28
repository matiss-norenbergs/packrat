import { Copy } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatDownloadStatus } from "@/lib/utils"
import type { LogEntry } from "@/types/api"

const STATUS_VARIANT: Record<string, "success" | "secondary" | "destructive" | "outline"> = {
  completed: "success",
  failed: "destructive",
  cancelled: "outline",
  interrupted: "destructive",
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text)
  toast.success("Copied to clipboard")
}

function LogSection({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Button variant="ghost" size="icon" className="h-6 w-6" title={`Copy ${label}`} onClick={() => copyToClipboard(text)}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
      <pre className="max-h-[50vh] min-w-0 overflow-x-auto overflow-y-auto rounded-md bg-muted p-3 font-mono text-xs">
        {text}
      </pre>
    </div>
  )
}

interface LogDetailDialogProps {
  entry: LogEntry
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LogDetailDialog({ entry, open, onOpenChange }: LogDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <DialogTitle className="truncate">{entry.title ?? entry.url}</DialogTitle>
            <Badge variant={STATUS_VARIANT[entry.status] ?? "outline"}>{formatDownloadStatus(entry.status)}</Badge>
          </div>
        </DialogHeader>

        <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Exit code: {entry.exitCode ?? "—"}</span>
          {entry.retryCount > 0 && <span>Retries: {entry.retryCount}</span>}
          <span>Created: {new Date(entry.createdAt).toLocaleString()}</span>
          {entry.completedAt && <span>Completed: {new Date(entry.completedAt).toLocaleString()}</span>}
        </div>

        <div className="min-w-0 space-y-4">
          {entry.ytdlpCommand && <LogSection label="Command" text={entry.ytdlpCommand} />}
          {entry.stdoutTail && <LogSection label="stdout" text={entry.stdoutTail} />}
          {entry.stderrTail && <LogSection label="stderr" text={entry.stderrTail} />}
          {!entry.ytdlpCommand && !entry.stdoutTail && !entry.stderrTail && (
            <p className="text-sm text-muted-foreground">No log captured for this download.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

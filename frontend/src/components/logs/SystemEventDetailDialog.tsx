import { Copy } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SYSTEM_EVENT_LEVEL_VARIANT } from "@/components/logs/systemEventLevel"
import type { SystemEvent } from "@/types/api"

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success("Copied to clipboard")
  } catch {
    toast.error("Couldn't copy to the clipboard")
  }
}

interface SystemEventDetailDialogProps {
  event: SystemEvent
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SystemEventDetailDialog({ event, open, onOpenChange }: SystemEventDetailDialogProps) {
  const details = event.details != null ? JSON.stringify(event.details, null, 2) : null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <DialogTitle className="min-w-0 break-words">{event.message}</DialogTitle>
            <Badge variant={SYSTEM_EVENT_LEVEL_VARIANT[event.level] ?? "secondary"} className="capitalize">{event.level}</Badge>
          </div>
          <DialogDescription className="sr-only">System log event details</DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Time: {new Date(event.createdAt).toLocaleString()}</span>
          <span>Level: <span className="capitalize">{event.level}</span></span>
          <span>Category: <span className="capitalize">{event.category}</span></span>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Details</p>
            {details != null && (
              <Button variant="ghost" size="icon" className="h-6 w-6" title="Copy details" aria-label="Copy details" onClick={() => copyToClipboard(details)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {details != null ? (
            <pre className="max-h-[50vh] min-w-0 overflow-x-auto overflow-y-auto rounded-md bg-muted p-3 font-mono text-xs">{details}</pre>
          ) : (
            <p className="text-sm text-muted-foreground">This event has no details.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

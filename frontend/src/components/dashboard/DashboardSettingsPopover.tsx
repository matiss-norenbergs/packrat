import { useState } from "react"
import { Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { DASHBOARD_WIDGETS } from "@/lib/dashboardWidgets"

interface DashboardSettingsPopoverProps {
  hiddenWidgets: string[]
  saving?: boolean
  onSave: (hiddenWidgets: string[]) => void
}

export function DashboardSettingsPopover({ hiddenWidgets, saving, onSave }: DashboardSettingsPopoverProps) {
  const [open, setOpen] = useState(false)
  const [draftHidden, setDraftHidden] = useState<string[]>([])

  const handleOpenChange = (next: boolean) => {
    // Seed the draft from the saved value each time the popover opens, so
    // abandoned edits don't linger.
    if (next) setDraftHidden(hiddenWidgets)
    setOpen(next)
  }

  const setVisible = (id: string, visible: boolean) => {
    setDraftHidden((prev) => (visible ? prev.filter((h) => h !== id) : prev.includes(id) ? prev : [...prev, id]))
  }

  const save = () => {
    onSave(draftHidden)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Dashboard settings">
          <Settings className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4">
        <div className="space-y-3">
          <Label className="text-xs text-muted-foreground">Visible cards</Label>
          {DASHBOARD_WIDGETS.map((widget) => (
            <div key={widget.id} className="flex items-center justify-between gap-2">
              <Label htmlFor={`dashboard-widget-${widget.id}`} className="font-normal">
                {widget.label}
              </Label>
              <Switch
                id={`dashboard-widget-${widget.id}`}
                checked={!draftHidden.includes(widget.id)}
                onCheckedChange={(checked) => setVisible(widget.id, checked)}
              />
            </div>
          ))}
        </div>
        <Button className="w-full" size="sm" onClick={save} disabled={saving}>
          Save
        </Button>
      </PopoverContent>
    </Popover>
  )
}

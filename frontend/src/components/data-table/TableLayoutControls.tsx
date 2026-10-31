import { useState } from "react"
import { Columns3, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export interface ColumnsMenuItem {
  key: string
  label: string
  visible: boolean
}

// Same control as the Library toolbar's "Columns" menu (checkbox items; choosing one keeps the menu open),
// icon-only so it fits the end of a table toolbar.
export function ColumnsMenu({ items, onToggle }: { items: ColumnsMenuItem[]; onToggle: (key: string) => void }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Columns">
              <Columns3 />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Columns</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-48">
        {items.map((item) => (
          <DropdownMenuCheckboxItem
            key={item.key}
            checked={item.visible}
            onSelect={(e) => {
              e.preventDefault()
              onToggle(item.key)
            }}
          >
            {item.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Save / Restore / Clear for the table's layout. Nothing here is pending or animated: each action closes
// the popover, and the layout hook toasts when the server answers.
export function LayoutPopover({
  dirty,
  hasSaved,
  onSave,
  onRestore,
  onClear,
}: {
  dirty: boolean
  hasSaved: boolean
  onSave: () => void
  onRestore: () => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const run = (action: () => void) => () => {
    setOpen(false)
    action()
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Table layout" className="relative">
              <Save />
              {dirty && <span data-testid="layout-dirty-dot" className="absolute right-0.5 top-0.5 size-2 rounded-full bg-primary" />}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Table layout</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-56 space-y-2">
        <p className="text-xs text-muted-foreground">Changes apply to this page until you save them.</p>
        <div className="flex flex-col gap-1.5">
          <Button size="sm" disabled={!dirty} onClick={run(onSave)}>
            Save
          </Button>
          <Button variant="outline" size="sm" disabled={!dirty} onClick={run(onRestore)}>
            {hasSaved ? "Restore saved" : "Restore defaults"}
          </Button>
          <Button variant="outline" size="sm" disabled={!hasSaved} onClick={run(onClear)}>
            Clear saved layout
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

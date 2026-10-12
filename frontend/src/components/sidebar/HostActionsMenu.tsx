import { useState } from "react"
import { Loader2Icon, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useHostActions, useRunHostAction } from "@/hooks/useHostActions"
import type { HostAction } from "@/types/api"

// Sidebar "Actions" menu — buttons defined by PACKRAT_ACTION_<N>_* env vars
// (e.g. start/stop Stable Diffusion via tools/sd-launcher). Renders nothing
// when none are configured.
export function HostActionsMenu() {
  const { data: actions } = useHostActions()
  const run = useRunHostAction()
  const [pendingConfirm, setPendingConfirm] = useState<HostAction | null>(null)

  if (!actions || actions.length === 0) return null

  const trigger = (action: HostAction) => {
    if (action.confirm) setPendingConfirm(action)
    else run.mutate(action)
  }

  return (
    <div className="px-2 pt-2">
      {/* modal={false}: the confirm dialog opens from a menu item, and a modal
          menu would leave pointer-events locked on <body> after it closes. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="w-full justify-start gap-2 text-sidebar-foreground" disabled={run.isPending}>
            {run.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {run.isPending ? `${run.variables?.label ?? "Running"}…` : "Actions"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-52">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Host actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {actions.map((action) => (
            <DropdownMenuItem key={action.id} onSelect={() => trigger(action)}>
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={pendingConfirm !== null} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingConfirm?.label}?</AlertDialogTitle>
            <AlertDialogDescription>This runs the configured host action.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingConfirm) run.mutate(pendingConfirm)
                setPendingConfirm(null)
              }}
            >
              Run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

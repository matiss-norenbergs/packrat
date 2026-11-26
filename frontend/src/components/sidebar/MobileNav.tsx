import { useEffect, useState } from "react"
import { useLocation } from "react-router-dom"
import { Menu, X } from "lucide-react"
import { PackratLogo } from "@/components/PackratLogo"
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button"
import { SidebarContent } from "./Sidebar"

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  return (
    <div className="md:hidden">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border bg-sidebar px-4">
        <TooltipIconButton label="Open menu" variant="ghost" size="icon" onClick={() => setOpen(true)}>
          <Menu className="h-5 w-5" />
        </TooltipIconButton>
        <PackratLogo className="h-5 w-5 shrink-0" />
        <span className="text-base font-semibold text-sidebar-foreground">Packrat</span>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
            <div className="flex justify-end px-2 pt-2">
              <TooltipIconButton label="Close menu" variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </TooltipIconButton>
            </div>
            <SidebarContent />
          </div>
        </>
      )}
    </div>
  )
}

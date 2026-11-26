import { useEffect, useState } from "react"
import { useLocation } from "react-router-dom"
import { Menu, X } from "lucide-react"
import { PackratLogo } from "@/components/PackratLogo"
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { SidebarContent } from "./Sidebar"

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  return (
    <div className="md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border bg-sidebar px-4">
          {/* The trigger gives the toggle aria-expanded / aria-haspopup, and focus returns to it when the drawer closes. */}
          <SheetTrigger asChild>
            <TooltipIconButton label="Open menu" variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
            </TooltipIconButton>
          </SheetTrigger>
          <PackratLogo className="h-5 w-5 shrink-0" />
          <span className="text-base font-semibold text-sidebar-foreground">Packrat</span>
        </div>

        <SheetContent side="left">
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>
          <SheetDescription className="sr-only">Pages of Packrat</SheetDescription>
          <div className="flex justify-end px-2 pt-2">
            <SheetClose asChild>
              <TooltipIconButton label="Close menu" variant="ghost" size="icon">
                <X className="h-5 w-5" />
              </TooltipIconButton>
            </SheetClose>
          </div>
          <SidebarContent />
        </SheetContent>
      </Sheet>
    </div>
  )
}

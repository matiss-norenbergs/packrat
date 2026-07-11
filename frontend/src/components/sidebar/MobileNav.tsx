import { useEffect, useState } from "react"
import { useLocation } from "react-router-dom"
import { Menu, Package, X } from "lucide-react"
import { Button } from "@/components/ui/button"
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
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} title="Open menu">
          <Menu className="h-5 w-5" />
        </Button>
        <Package className="h-5 w-5 text-sidebar-foreground" />
        <span className="text-base font-semibold text-sidebar-foreground">Packrat</span>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
            <div className="flex justify-end px-2 pt-2">
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} title="Close menu">
                <X className="h-5 w-5" />
              </Button>
            </div>
            <SidebarContent />
          </div>
        </>
      )}
    </div>
  )
}

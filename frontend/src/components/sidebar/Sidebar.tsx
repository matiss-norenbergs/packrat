import {
  LayoutDashboard,
  Download,
  Library,
  FolderKanban,
  Import,
  History,
  Settings,
  ScrollText,
  Package,
} from "lucide-react"
import { NavItem } from "./NavItem"

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/downloads", label: "Downloads", icon: Download },
  { to: "/library", label: "Library", icon: Library },
  { to: "/collections", label: "Collections", icon: FolderKanban },
  { to: "/import", label: "Import", icon: Import },
  { to: "/history", label: "History", icon: History },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/logs", label: "Logs", icon: ScrollText },
]

export function Sidebar() {
  return (
    <aside className="flex h-screen w-56 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2 px-4 py-4">
        <Package className="h-5 w-5 text-sidebar-foreground" />
        <span className="text-base font-semibold text-sidebar-foreground">Packrat</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2">
        {navItems.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>
    </aside>
  )
}

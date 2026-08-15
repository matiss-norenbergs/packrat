import type { ReactNode } from "react"
import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

interface NavItemProps {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  endAdornment?: ReactNode
}

export function NavItem({ to, label, icon: Icon, end, endAdornment }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )
      }
    >
      <Icon className="h-4 w-4" />
      {label}
      {endAdornment && <span className="ml-auto flex items-center">{endAdornment}</span>}
    </NavLink>
  )
}

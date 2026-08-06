import {
  LayoutDashboard,
  Download,
  Library,
  FolderKanban,
  GitCompare,
  Import,
  History,
  Settings,
  ScrollText,
  Package,
  Tags,
  Mic2,
  Archive,
  LogOut,
  MonitorPlay,
} from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useLogout } from "@/hooks/useAuth"
import { useAppVersion, useYtDlpVersion } from "@/hooks/useSettings"
import { NavItem } from "./NavItem"

// Matches the backend's version.Repo (backend/internal/version/latest.go) —
// only used here to build the "view release" link, not to query GitHub.
const GITHUB_REPO = "matiss-norenbergs/packrat"

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/downloads", label: "Downloads", icon: Download },
  { to: "/library", label: "Library", icon: Library },
  { to: "/collections", label: "Collections", icon: FolderKanban },
  { to: "/tags", label: "Tags", icon: Tags },
  { to: "/artists", label: "Artists", icon: Mic2 },
  { to: "/compare-list", label: "Compare list", icon: GitCompare },
  { to: "/import", label: "File Import", icon: Import },
  { to: "/history", label: "History", icon: History },
  { to: "/backup", label: "Backup", icon: Archive },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/logs", label: "Logs", icon: ScrollText },
]

export function SidebarContent() {
  const logout = useLogout()

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-4">
        <Package className="h-5 w-5 text-sidebar-foreground" />
        <span className="text-base font-semibold text-sidebar-foreground">Packrat</span>
      </div>
      <div className="px-2 pb-2">
        <Link
          to="/browse"
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <MonitorPlay className="h-4 w-4" />
          Browse Library
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2">
        {navItems.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>
      <AppVersionLine />
      <VersionLine />
      <div className="px-2 py-2">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-sidebar-foreground"
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
        >
          <LogOut className="h-4 w-4" />
          Log out
        </Button>
      </div>
    </>
  )
}

function AppVersionLine() {
  const { data } = useAppVersion()
  if (!data) return null

  const content = (
    <>
      <span>Packrat v{data.version}</span>
      {data.updateAvailable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          </TooltipTrigger>
          <TooltipContent>Update available: v{data.latestVersion}</TooltipContent>
        </Tooltip>
      )}
    </>
  )

  if (!data.updateAvailable) {
    return <div className="flex items-center gap-1.5 px-4 py-1 text-xs text-muted-foreground">{content}</div>
  }

  return (
    <a
      href={`https://github.com/${GITHUB_REPO}/releases/latest`}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1.5 px-4 py-1 text-xs text-muted-foreground hover:text-sidebar-foreground"
    >
      {content}
    </a>
  )
}

function VersionLine() {
  const { data } = useYtDlpVersion()
  if (!data) return null

  return (
    <Link
      to="/settings"
      className="flex items-center gap-1.5 px-4 py-1 text-xs text-muted-foreground hover:text-sidebar-foreground"
    >
      <span>yt-dlp v{data.currentVersion}</span>
      {data.updateAvailable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          </TooltipTrigger>
          <TooltipContent>Update available</TooltipContent>
        </Tooltip>
      )}
    </Link>
  )
}

export function Sidebar() {
  return (
    <aside className="hidden h-screen w-56 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <SidebarContent />
    </aside>
  )
}

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
  Rss,
  ImageUp,
  ScanSearch,
} from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useLogout } from "@/hooks/useAuth"
import { useAppVersion, useSettings, useYtDlpVersion } from "@/hooks/useSettings"
import { useThumbnailEnhancementStatus } from "@/hooks/useThumbnailEnhancement"
import { enhancementStatusColor } from "@/lib/enhancementStatus"
import { cn } from "@/lib/utils"
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
  { to: "/subscriptions", label: "Subscriptions", icon: Rss },
  {
    to: "/thumbnail-enhancement",
    label: "AI Enhancement",
    icon: ImageUp,
    requiresSetting: "thumbnailEnhancementEnabled" as const,
    endAdornment: <AiEnhancementStatusDot />,
  },
  { to: "/frame-matching", label: "Frame Matching", icon: ScanSearch },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/logs", label: "Logs", icon: ScrollText },
]

export function SidebarContent() {
  const logout = useLogout()
  const { data: settings } = useSettings()

  // A nav item tagged requiresSetting only shows once that setting is known
  // to be on — hidden both while settings are still loading and once
  // they're confirmed off, so a feature nobody's enabled doesn't clutter
  // the nav with a page that'll just tell them to go enable it.
  const visibleNavItems = navItems.filter((item) => !item.requiresSetting || settings?.[item.requiresSetting])

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
        {visibleNavItems.map((item) => (
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

const STATUS_DOT_CLASSNAME: Record<ReturnType<typeof enhancementStatusColor>, string> = {
  green: "bg-emerald-500",
  red: "bg-destructive",
  grey: "bg-muted-foreground/40",
}

const STATUS_DOT_LABEL: Record<ReturnType<typeof enhancementStatusColor>, string> = {
  green: "Stable Diffusion instance is active and reachable",
  red: "Stable Diffusion instance is configured but not reachable",
  grey: "Stable Diffusion instance is not configured",
}

// Mirrors the AI Enhancement page's own status badge (see
// lib/enhancementStatus) — this nav item is only ever rendered once the
// thumbnailEnhancementEnabled setting is on, so the status query always
// runs while it's visible, giving the sidebar a live indicator without
// requiring the page itself to be open.
function AiEnhancementStatusDot() {
  const { data: status, isLoading } = useThumbnailEnhancementStatus(true)
  const color = enhancementStatusColor(status, isLoading)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT_CLASSNAME[color])} />
      </TooltipTrigger>
      <TooltipContent>{STATUS_DOT_LABEL[color]}</TooltipContent>
    </Tooltip>
  )
}

function AppVersionLine() {
  const { data } = useAppVersion()
  if (!data) return null

  const content = (
    <>
      <span>Packrat</span>
      <span className="flex items-center gap-1.5">
        v{data.version}
        {data.updateAvailable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            </TooltipTrigger>
            <TooltipContent>Update available: v{data.latestVersion}</TooltipContent>
          </Tooltip>
        )}
      </span>
    </>
  )

  if (!data.updateAvailable) {
    return <div className="flex items-center justify-between px-4 py-1 text-xs text-muted-foreground">{content}</div>
  }

  return (
    <a
      href={`https://github.com/${GITHUB_REPO}/releases/latest`}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between px-4 py-1 text-xs text-muted-foreground hover:text-sidebar-foreground"
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
      className="flex items-center justify-between px-4 py-1 text-xs text-muted-foreground hover:text-sidebar-foreground"
    >
      <span>yt-dlp</span>
      <span className="flex items-center gap-1.5">
        v{data.currentVersion}
        {data.updateAvailable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            </TooltipTrigger>
            <TooltipContent>Update available</TooltipContent>
          </Tooltip>
        )}
      </span>
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

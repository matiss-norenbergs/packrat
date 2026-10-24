import { useSyncExternalStore, type ReactNode } from "react"
import { Check, ChevronsUpDown, Plus, Server, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { openProfile, startAddingServer } from "@/lib/serverSwitch"
import { useAppVersion } from "@/hooks/useSettings"
import {
  getActiveProfile,
  getActiveProfileName,
  subscribeProfiles,
  getProfiles,
  isDesktop,
} from "@/lib/server"

// The menu itself, around whatever `trigger` the caller renders: the saved servers (the current one
// marked), "Add server…" and, where the settings are reachable, "Manage servers".
export function ServerSwitcherMenu({
  trigger,
  onManage,
  side = "top",
  align = "start",
  className,
}: {
  trigger: ReactNode
  onManage?: () => void
  side?: "top" | "bottom"
  align?: "start" | "end"
  className?: string
}) {
  const profiles = getProfiles()
  const activeId = getActiveProfile()?.id

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className={className ?? "w-60"}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">Servers</DropdownMenuLabel>
        {profiles.map((profile) => (
          <DropdownMenuItem
            key={profile.id}
            onSelect={() => (profile.id === activeId ? undefined : openProfile(profile.id))}
            className="gap-2"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{profile.name}</span>
              <span className="truncate text-xs text-muted-foreground">{profile.url}</span>
            </span>
            {profile.id === activeId && <Check className="h-4 w-4 shrink-0" aria-label="Current server" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={startAddingServer} className="gap-2">
          <Plus className="h-4 w-4" />
          Add server…
        </DropdownMenuItem>
        {onManage && (
          <DropdownMenuItem onSelect={onManage} className="gap-2">
            <Settings2 className="h-4 w-4" />
            Manage servers
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Sidebar footer entry: the current server's name and version; opens the menu above it.
export function SidebarServerSwitcher({ onManage }: { onManage: () => void }) {
  const { data } = useAppVersion()
  // Renaming the current server in Settings updates this without a reload.
  const name = useSyncExternalStore(subscribeProfiles, getActiveProfileName)
  if (!isDesktop()) return null

  return (
    <div className="px-2 pt-2">
      <ServerSwitcherMenu
        onManage={onManage}
        trigger={
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-2 px-3 py-2 text-sidebar-foreground"
            aria-label="Switch server"
          >
            <Server className="h-4 w-4 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col items-start text-left">
              <span className="w-full truncate text-sm">{name ?? "Server"}</span>
              {data && <span className="text-xs font-normal text-muted-foreground">v{data.version}</span>}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        }
      />
    </div>
  )
}

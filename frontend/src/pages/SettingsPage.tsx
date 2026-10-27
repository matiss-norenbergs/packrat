import { useSearchParams } from "react-router-dom"
import { isDesktop } from "@/lib/server"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GeneralTab } from "@/components/settings/tabs/GeneralTab"
import { AccountTab } from "@/components/settings/tabs/AccountTab"
import { DownloadsTab } from "@/components/settings/tabs/DownloadsTab"
import { NotificationsTab } from "@/components/settings/tabs/NotificationsTab"
import { LibraryTab } from "@/components/settings/tabs/LibraryTab"
import { FeaturesTab } from "@/components/settings/tabs/FeaturesTab"
import { PrivacyTab } from "@/components/settings/tabs/PrivacyTab"
import { HistoryTab } from "@/components/settings/tabs/HistoryTab"
import { BackupTab } from "@/components/settings/tabs/BackupTab"
import { JellyfinTab } from "@/components/settings/tabs/JellyfinTab"
import { ThumbnailEnhancementTab } from "@/components/settings/tabs/ThumbnailEnhancementTab"
import { YtDlpTab } from "@/components/settings/tabs/YtDlpTab"
import { DesktopTab } from "@/components/settings/tabs/DesktopTab"
import { AppearanceTab } from "@/components/settings/tabs/AppearanceTab"

const SETTINGS_TABS = [
  "general",
  "account",
  "downloads",
  "library",
  "features",
  "privacy",
  "history",
  "backup",
  "jellyfin",
  "notifications",
  "ai-enhance",
  "ytdlp",
  "appearance",
  "desktop",
] as const

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get("tab")
  // "desktop" only exists inside the desktop shell; on the web a stale ?tab=desktop falls back.
  const activeTab =
    (SETTINGS_TABS as readonly string[]).includes(tabParam ?? "") && (tabParam !== "desktop" || isDesktop())
      ? tabParam!
      : "general"

  const setActiveTab = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === "general") next.delete("tab")
    else next.set("tab", value)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="flex h-full flex-col space-y-6">
      <h1 className="shrink-0 text-2xl font-semibold">Settings</h1>

      {/* min-h-0 lets this flex child actually shrink below its content
          height — without it, the flex-1 content pane below can't establish
          a bounded height to scroll within, and just grows the whole page
          instead (a classic flexbox-overflow gotcha). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 gap-0">
          <TabsList className="shrink-0 px-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="downloads">Downloads</TabsTrigger>
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="features">Features</TabsTrigger>
            <TabsTrigger value="privacy">Privacy</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="backup">Backup</TabsTrigger>
            <TabsTrigger value="jellyfin">Jellyfin</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="ai-enhance">AI Enhancement</TabsTrigger>
            <TabsTrigger value="ytdlp">yt-dlp</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            {isDesktop() && <TabsTrigger value="desktop">Desktop</TabsTrigger>}
          </TabsList>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <TabsContent value="general" className="mt-0 h-full">
              <GeneralTab />
            </TabsContent>
            <TabsContent value="account" className="mt-0 h-full">
              <AccountTab />
            </TabsContent>
            <TabsContent value="downloads" className="mt-0 h-full">
              <DownloadsTab />
            </TabsContent>
            <TabsContent value="library" className="mt-0 h-full">
              <LibraryTab />
            </TabsContent>
            <TabsContent value="features" className="mt-0 h-full">
              <FeaturesTab />
            </TabsContent>
            <TabsContent value="privacy" className="mt-0 h-full">
              <PrivacyTab />
            </TabsContent>
            <TabsContent value="history" className="mt-0 h-full">
              <HistoryTab />
            </TabsContent>
            <TabsContent value="backup" className="mt-0 h-full">
              <BackupTab />
            </TabsContent>
            <TabsContent value="jellyfin" className="mt-0 h-full">
              <JellyfinTab />
            </TabsContent>
            <TabsContent value="notifications" className="mt-0 h-full">
              <NotificationsTab />
            </TabsContent>
            <TabsContent value="ai-enhance" className="mt-0 h-full">
              <ThumbnailEnhancementTab />
            </TabsContent>
            <TabsContent value="ytdlp" className="mt-0 h-full">
              <YtDlpTab />
            </TabsContent>
            <TabsContent value="appearance" className="mt-0 h-full">
              <AppearanceTab />
            </TabsContent>
            {isDesktop() && (
              <TabsContent value="desktop" className="mt-0 h-full">
                <DesktopTab />
              </TabsContent>
            )}
          </div>
        </Tabs>
      </div>
    </div>
  )
}

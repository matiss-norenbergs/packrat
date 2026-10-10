import { createBrowserRouter, matchRoutes } from "react-router-dom"
import { AppLayout } from "@/layouts/AppLayout"
import { BrowseLayout } from "@/layouts/BrowseLayout"
import { ImmersiveLayout } from "@/layouts/ImmersiveLayout"
import { authStatusQueryKey } from "@/hooks/useAuth"
import { fetchAuthStatus } from "@/lib/api"
import { queryClient } from "@/lib/queryClient"
import { RouteError } from "@/components/RouteError"

// Every page is its own chunk (router-level `lazy`) so the shell — layouts,
// sidebar, auth gate — stays small and recharts only ships with the
// Dashboard. Route `lazy` resolves the chunk *before* the route renders, so
// there is no Suspense fallback to flash (or to be throttled by React's
// 300 ms reveal delay) and a click keeps showing the current page until the
// next one is ready. The router starts loading the initial URL's chunk as
// soon as it is created, so the auth check is started here too, rather than
// only when the layout mounts after that chunk arrives.
void queryClient.prefetchQuery({ queryKey: authStatusQueryKey, queryFn: fetchAuthStatus })

// `handle.preload` lets a link hover/focus start the chunk fetch early (see the
// listeners at the bottom); `lazy` then resolves from the module cache.
const page = <T extends string>(load: () => Promise<Record<T, React.ComponentType>>, name: T) => ({
  lazy: async () => ({ Component: (await load())[name] }),
  handle: { preload: () => void load().catch(() => {}) },
})

const LoginPage = page(() => import("@/pages/LoginPage"), "LoginPage")
const DashboardPage = page(() => import("@/pages/DashboardPage"), "DashboardPage")
const DownloadsPage = page(() => import("@/pages/DownloadsPage"), "DownloadsPage")
const LibraryPage = page(() => import("@/pages/LibraryPage"), "LibraryPage")
const LibraryItemPage = page(() => import("@/pages/LibraryItemPage"), "LibraryItemPage")
const CollectionsPage = page(() => import("@/pages/CollectionsPage"), "CollectionsPage")
const TagsPage = page(() => import("@/pages/TagsPage"), "TagsPage")
const ArtistsPage = page(() => import("@/pages/ArtistsPage"), "ArtistsPage")
const CompareListPage = page(() => import("@/pages/CompareListPage"), "CompareListPage")
const ComparePlayPage = page(() => import("@/pages/ComparePlayPage"), "ComparePlayPage")
const ImportPage = page(() => import("@/pages/ImportPage"), "ImportPage")
const HistoryPage = page(() => import("@/pages/HistoryPage"), "HistoryPage")
const BackupPage = page(() => import("@/pages/BackupPage"), "BackupPage")
const SubscriptionsPage = page(() => import("@/pages/SubscriptionsPage"), "SubscriptionsPage")
const ThumbnailEnhancementPage = page(() => import("@/pages/ThumbnailEnhancementPage"), "ThumbnailEnhancementPage")
const FrameMatchingPage = page(() => import("@/pages/FrameMatchingPage"), "FrameMatchingPage")
const SettingsPage = page(() => import("@/pages/SettingsPage"), "SettingsPage")
const LogsPage = page(() => import("@/pages/LogsPage"), "LogsPage")
const BrowsePage = page(() => import("@/pages/BrowsePage"), "BrowsePage")
const BrowseItemPage = page(() => import("@/pages/BrowseItemPage"), "BrowseItemPage")
const BrowseShowPage = page(() => import("@/pages/BrowseShowPage"), "BrowseShowPage")
const BrowseArtistPage = page(() => import("@/pages/BrowseArtistPage"), "BrowseArtistPage")

// Each top-level branch carries the error element (failed page chunk, render
// error); see RouteError.
export const router = createBrowserRouter([
  { path: "/login", errorElement: <RouteError />, ...LoginPage },
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { path: "/", ...DashboardPage },
      { path: "/downloads", ...DownloadsPage },
      { path: "/library", ...LibraryPage },
      { path: "/library/:id", ...LibraryItemPage },
      { path: "/collections", ...CollectionsPage },
      { path: "/tags", ...TagsPage },
      { path: "/artists", ...ArtistsPage },
      { path: "/compare-list", ...CompareListPage },
      { path: "/import", ...ImportPage },
      { path: "/history", ...HistoryPage },
      { path: "/backup", ...BackupPage },
      { path: "/subscriptions", ...SubscriptionsPage },
      { path: "/thumbnail-enhancement", ...ThumbnailEnhancementPage },
      { path: "/frame-matching", ...FrameMatchingPage },
      { path: "/settings", ...SettingsPage },
      { path: "/logs", ...LogsPage },
    ],
  },
  {
    // A deliberately separate branch from AppLayout — see BrowseLayout for
    // why (no shared Sidebar/MobileNav with the management area).
    element: <BrowseLayout />,
    errorElement: <RouteError />,
    children: [
      { path: "/browse", ...BrowsePage },
      { path: "/browse/collection/:id", ...BrowseShowPage },
      { path: "/browse/artist/:id", ...BrowseArtistPage },
      { path: "/browse/:id", ...BrowseItemPage },
    ],
  },
  {
    // A third, deliberately chrome-less branch — see ImmersiveLayout for why
    // this can't just reuse BrowseLayout or AppLayout.
    element: <ImmersiveLayout />,
    errorElement: <RouteError />,
    children: [{ path: "/compare-list/play", ...ComparePlayPage }],
  },
])

// Navigation to a not-yet-loaded page otherwise waits a full chunk round trip
// after the click. Hovering, focusing or touching an in-app link starts that
// fetch ahead of time; one delegated listener covers every <a> in the app.
function preloadLink(e: Event) {
  const a = (e.target as Element | null)?.closest?.("a[href]")
  const href = a?.getAttribute("href")
  if (!href?.startsWith("/") || href.startsWith("//")) return
  for (const m of matchRoutes(router.routes, href) ?? []) {
    ;(m.route.handle as { preload?: () => void } | undefined)?.preload?.()
  }
}
document.addEventListener("pointerover", preloadLink, { passive: true })
document.addEventListener("focusin", preloadLink, { passive: true })

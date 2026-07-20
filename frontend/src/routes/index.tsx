import { createBrowserRouter } from "react-router-dom"
import { AppLayout } from "@/layouts/AppLayout"
import { BrowseLayout } from "@/layouts/BrowseLayout"
import { LoginPage } from "@/pages/LoginPage"
import { DashboardPage } from "@/pages/DashboardPage"
import { DownloadsPage } from "@/pages/DownloadsPage"
import { LibraryPage } from "@/pages/LibraryPage"
import { LibraryItemPage } from "@/pages/LibraryItemPage"
import { CollectionsPage } from "@/pages/CollectionsPage"
import { TagsPage } from "@/pages/TagsPage"
import { ArtistsPage } from "@/pages/ArtistsPage"
import { ImportPage } from "@/pages/ImportPage"
import { HistoryPage } from "@/pages/HistoryPage"
import { BackupPage } from "@/pages/BackupPage"
import { SettingsPage } from "@/pages/SettingsPage"
import { LogsPage } from "@/pages/LogsPage"
import { BrowsePage } from "@/pages/BrowsePage"
import { BrowseItemPage } from "@/pages/BrowseItemPage"

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <DashboardPage /> },
      { path: "/downloads", element: <DownloadsPage /> },
      { path: "/library", element: <LibraryPage /> },
      { path: "/library/:id", element: <LibraryItemPage /> },
      { path: "/collections", element: <CollectionsPage /> },
      { path: "/tags", element: <TagsPage /> },
      { path: "/artists", element: <ArtistsPage /> },
      { path: "/import", element: <ImportPage /> },
      { path: "/history", element: <HistoryPage /> },
      { path: "/backup", element: <BackupPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/logs", element: <LogsPage /> },
    ],
  },
  {
    // A deliberately separate branch from AppLayout — see BrowseLayout for
    // why (no shared Sidebar/MobileNav with the management area).
    element: <BrowseLayout />,
    children: [
      { path: "/browse", element: <BrowsePage /> },
      { path: "/browse/:id", element: <BrowseItemPage /> },
    ],
  },
])

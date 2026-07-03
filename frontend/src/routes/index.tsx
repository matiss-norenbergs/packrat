import { createBrowserRouter } from "react-router-dom"
import { AppLayout } from "@/layouts/AppLayout"
import { DashboardPage } from "@/pages/DashboardPage"
import { DownloadsPage } from "@/pages/DownloadsPage"
import { LibraryPage } from "@/pages/LibraryPage"
import { CollectionsPage } from "@/pages/CollectionsPage"
import { HistoryPage } from "@/pages/HistoryPage"
import { SettingsPage } from "@/pages/SettingsPage"
import { LogsPage } from "@/pages/LogsPage"

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <DashboardPage /> },
      { path: "/downloads", element: <DownloadsPage /> },
      { path: "/library", element: <LibraryPage /> },
      { path: "/collections", element: <CollectionsPage /> },
      { path: "/history", element: <HistoryPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/logs", element: <LogsPage /> },
    ],
  },
])

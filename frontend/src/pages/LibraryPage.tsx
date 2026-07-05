import { LibraryFolderView } from "@/components/library/LibraryFolderView"
import { LibraryGrid } from "@/components/library/LibraryGrid"
import { LibraryToolbar } from "@/components/library/LibraryToolbar"
import { useSettings } from "@/hooks/useSettings"

export function LibraryPage() {
  const { data: settings } = useSettings()
  const view = settings?.libraryView === "folders" ? "folders" : "grid"

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Library</h1>
      <LibraryToolbar />
      {view === "folders" ? <LibraryFolderView /> : <LibraryGrid />}
    </div>
  )
}

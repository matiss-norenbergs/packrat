import { useSearchParams } from "react-router-dom"
import { LibraryFolderView } from "@/components/library/LibraryFolderView"
import { LibraryGrid } from "@/components/library/LibraryGrid"
import { LibraryToolbar } from "@/components/library/LibraryToolbar"

export function LibraryPage() {
  const [searchParams] = useSearchParams()
  const view = searchParams.get("view") === "folders" ? "folders" : "grid"

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Library</h1>
      <LibraryToolbar />
      {view === "folders" ? <LibraryFolderView /> : <LibraryGrid />}
    </div>
  )
}

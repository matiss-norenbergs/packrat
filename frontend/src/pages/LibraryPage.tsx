import { LibraryFolderView } from "@/components/library/LibraryFolderView"
import { LibraryGrid } from "@/components/library/LibraryGrid"
import { LibraryListView } from "@/components/library/LibraryListView"
import { LibraryToolbar } from "@/components/library/LibraryToolbar"
import { RevealAllFloatingAction } from "@/components/library/RevealAllFloatingAction"
import { SelectionProvider } from "@/components/library/SelectionContext"
import { useSettings } from "@/hooks/useSettings"

export function LibraryPage() {
  const { data: settings } = useSettings()
  const view =
    settings?.libraryView === "folders" ? "folders" : settings?.libraryView === "list" ? "list" : "grid"

  if (view === "list") {
    // The list owns its height like the table pages: a flex column that fills <main>, so only the table's scroll box scrolls.
    // Its toolbar is DataTable's own (LibraryListView feeds its slots), so there is no sticky wrapper.
    return (
      <SelectionProvider>
        <RevealAllFloatingAction />
        <div className="flex h-full min-h-0 flex-col gap-6">
          <h1 className="shrink-0 text-2xl font-semibold">Library</h1>
          <LibraryListView />
        </div>
      </SelectionProvider>
    )
  }

  // Grid and Folders: the same shell as the list. The toolbar row is fixed under the title (its border is a divider), the
  // views own the rest: the cards scroll in their region, the breadcrumb and the pagination footer stay in view.
  return (
    <SelectionProvider>
      <RevealAllFloatingAction />
      <div className="flex h-full min-h-0 flex-col gap-6">
        <h1 className="shrink-0 text-2xl font-semibold">Library</h1>
        <div className="shrink-0 border-b pb-3">
          <LibraryToolbar />
        </div>
        {view === "folders" ? <LibraryFolderView /> : <LibraryGrid />}
      </div>
    </SelectionProvider>
  )
}

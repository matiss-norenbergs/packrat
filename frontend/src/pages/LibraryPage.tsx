import { LibraryFolderView } from "@/components/library/LibraryFolderView"
import { LibraryGrid } from "@/components/library/LibraryGrid"
import { LibraryToolbar } from "@/components/library/LibraryToolbar"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { SelectionProvider } from "@/components/library/SelectionContext"
import { useSettings } from "@/hooks/useSettings"

export function LibraryPage() {
  const { data: settings } = useSettings()
  const view = settings?.libraryView === "folders" ? "folders" : "grid"

  return (
    <RevealAllProvider>
      <SelectionProvider>
        <div>
          <h1 className="text-2xl font-semibold">Library</h1>
          {/* mt-3 + pt-3 (rather than one mt-6/pt-0 split) is deliberate: margin
              only holds space before the toolbar starts sticking, while padding
              stays part of the box once it's pinned. So at rest the two stack
              into the original 24px gap below the title, but once stuck (flush
              against -top-4/-top-6, see below) only the 12px padding survives —
              giving breathing room from the viewport edge with no JS/observer
              needed to tell the two states apart. */}
          <div className="sticky -top-4 z-10 -mx-4 mt-3 mb-6 border-b bg-background px-4 pb-3 pt-3 md:-top-6 md:-mx-6 md:px-6">
            <LibraryToolbar />
          </div>
          {view === "folders" ? <LibraryFolderView /> : <LibraryGrid />}
        </div>
      </SelectionProvider>
    </RevealAllProvider>
  )
}

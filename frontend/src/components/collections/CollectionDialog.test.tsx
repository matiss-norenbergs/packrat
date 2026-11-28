import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { CollectionDialog } from "@/components/collections/CollectionDialog"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import type { Collection } from "@/types/api"


const HINT = "Existing files stay where they are; only new downloads use the new folder."

const EXISTING = {
  id: 3,
  name: "Show",
  parentId: null,
  rootPath: "Show",
  path: "Show",
  defaultQuality: "best",
  defaultDownloadType: "video",
  filenameTemplate: "",
  isPrivate: false,
  browseAsShow: false,
  jellyfinLibraryId: null,
  seasonNumber: null,
  year: null,
  sequenceMin: null,
  sequenceMax: null,
  artistId: null,
} as unknown as Collection

function setup(collection?: Collection) {
  mockFetch((url) => ({ status: 200, body: url.endsWith("/settings") ? {} : [] }))
  renderWithProviders(
    <TooltipProvider>
      <CollectionDialog open onOpenChange={() => {}} collection={collection} />
    </TooltipProvider>,
  )
}

describe("CollectionDialog folder name hint", () => {
  it("is hidden while the folder name is unchanged", async () => {
    setup(EXISTING)
    await screen.findByLabelText(/Folder name/)
    expect(screen.queryByText(HINT)).toBeNull()
  })

  it("shows once the folder name is changed when editing", async () => {
    const user = userEvent.setup()
    setup(EXISTING)
    await user.type(await screen.findByLabelText(/Folder name/), "2")
    expect(screen.getByText(HINT)).toBeInTheDocument()
  })

  it("is absent when creating", async () => {
    const user = userEvent.setup()
    setup()
    await user.type(await screen.findByLabelText(/Folder name/), "Music")
    expect(screen.queryByText(HINT)).toBeNull()
  })
})

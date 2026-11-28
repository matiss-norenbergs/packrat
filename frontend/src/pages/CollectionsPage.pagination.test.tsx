import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FloatingActionDock } from "@/components/FloatingActionDock"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { CollectionsPage } from "@/pages/CollectionsPage"
import { mockFetch, renderWithProviders } from "@/test/mockApi"

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }))
})

const make = (id: number) => ({
  id,
  name: `Root ${String(id).padStart(2, "0")}`,
  parentId: null,
  rootPath: "/r",
  path: `r${id}`,
  defaultQuality: "best",
  defaultDownloadType: "video",
  filenameTemplate: "",
  isPrivate: false,
  effectiveIsPrivate: false,
  itemCount: 0,
  totalItemCount: 0,
  ghostItemCount: 0,
  totalGhostItemCount: 0,
  sequenceGaps: null,
})

describe("CollectionsPage pagination", () => {
  it("lands on the previous page when the last page's only root is deleted", async () => {
    const user = userEvent.setup()
    let roots = Array.from({ length: 26 }, (_, i) => make(i + 1))
    mockFetch((url, init) => {
      if (url.endsWith("/collections/bulk-delete")) {
        roots = roots.filter((r) => r.id !== 26)
        return { status: 200, body: { deleted: 1, skipped: 0 } }
      }
      if (url.endsWith("/collections") && init.method !== "POST") return { status: 200, body: roots }
      if (url.endsWith("/settings")) return { status: 200, body: {} }
      return { status: 200, body: [] }
    })
    renderWithProviders(
      <TooltipProvider>
        <RevealAllProvider>
          <FloatingActionDock>
            <CollectionsPage />
          </FloatingActionDock>
        </RevealAllProvider>
      </TooltipProvider>,
    )
    expect(await screen.findByText(/26 top-level collections/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "2" }))
    await user.click(await screen.findByText("Root 26"))
    await user.click(screen.getByRole("button", { name: "Delete" }))
    const deletes = await screen.findAllByRole("button", { name: "Delete" })
    await user.click(deletes[deletes.length - 1]) // the confirmation dialog's action

    await waitFor(() => expect(screen.getByText(/25 top-level collections/)).toBeInTheDocument())
    expect(screen.getByText("Root 01")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "1" })).toHaveClass("bg-primary")
  })
})

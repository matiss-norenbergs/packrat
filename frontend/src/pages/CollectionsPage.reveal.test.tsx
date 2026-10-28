import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const base = {
  parentId: null,
  rootPath: "/r",
  path: "x",
  defaultQuality: "best",
  defaultDownloadType: "video",
  filenameTemplate: "",
  coverImagePath: "c.jpg",
  itemCount: 2,
  totalItemCount: 2,
  ghostItemCount: 0,
  totalGhostItemCount: 0,
  sequenceGaps: null,
}

function serve(privacy: boolean, isPrivate: boolean) {
  mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: privacy } }
    if (url.endsWith("/collections"))
      return { status: 200, body: [{ ...base, id: 1, name: "Movies", isPrivate, effectiveIsPrivate: isPrivate }] }
    if (url.endsWith("/tags")) return { status: 200, body: [] }
    if (url.endsWith("/artists")) return { status: 200, body: [] }
    return { status: 404 }
  })
}

function renderPage() {
  return renderWithProviders(
    <TooltipProvider>
      <RevealAllProvider>
        <FloatingActionDock>
          <CollectionsPage />
        </FloatingActionDock>
      </RevealAllProvider>
    </TooltipProvider>,
  )
}

const fab = () => screen.queryByRole("button", { name: /private items/ })
const cover = () => document.querySelector("img") as HTMLImageElement | null

describe("CollectionsPage reveal-all", () => {
  it("reveals the selected collection's cover from the floating button", async () => {
    const user = userEvent.setup()
    serve(true, true)
    renderPage()
    await user.click(await screen.findByText("Movies"))
    await waitFor(() => expect(cover()?.className).toContain("blur-"))
    await user.click(await screen.findByRole("button", { name: "Reveal all private items" }))
    expect(cover()?.className).not.toContain("blur-")
    await user.click(screen.getByRole("button", { name: "Hide all private items" }))
    expect(cover()?.className).toContain("blur-")
  })

  it("hides the button when privacy is off or nothing is private", async () => {
    serve(false, true)
    const { unmount } = renderPage()
    await screen.findByText("Movies")
    await new Promise((r) => setTimeout(r, 20))
    expect(fab()).toBeNull()
    unmount()

    serve(true, false)
    renderPage()
    await screen.findByText("Movies")
    await new Promise((r) => setTimeout(r, 20))
    expect(fab()).toBeNull()
  })
})

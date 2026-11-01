import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FloatingActionDock } from "@/components/FloatingActionDock"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ArtistsPage } from "@/pages/ArtistsPage"
import { hashText } from "@/lib/utils"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import type { Artist } from "@/types/api"

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

const artist = (id: number, name: string, over: Partial<Artist> = {}): Artist => ({
  id,
  name,
  selectedImagePath: "sel.jpg",
  birthday: null,
  isPrivate: false,
  createdAt: "",
  usageCount: 0,
  ...over,
})

const ARTISTS = [artist(1, "Hidden Person", { isPrivate: true }), artist(2, "Open Person")]

function renderPage(privacy = true) {
  mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: privacy } }
    if (url.endsWith("/artists")) return { status: 200, body: ARTISTS }
    if (/\/artists\/\d+\/images$/.test(url)) return { status: 200, body: [] }
    if (url.endsWith("/collections") || url.endsWith("/tags")) return { status: 200, body: [] }
    return { status: 404 }
  })
  return renderWithProviders(
    <TooltipProvider>
      <RevealAllProvider>
        <FloatingActionDock>
          <ArtistsPage />
        </FloatingActionDock>
      </RevealAllProvider>
    </TooltipProvider>,
  )
}

describe("ArtistsPage private artist names", () => {
  it("hashes a private artist's name (cell, row label, panel title) until reveal-all; public names stay", async () => {
    const user = userEvent.setup()
    renderPage()
    const hashed = hashText("Hidden Person")
    await screen.findByText(hashed)
    expect(screen.getByText("Open Person")).toBeInTheDocument()
    expect(screen.queryByText("Hidden Person")).toBeNull()
    expect(screen.getByRole("checkbox", { name: `Select ${hashed}` })).toBeInTheDocument()

    // Selecting shows the panel title hashed too, with the real name nowhere in the DOM.
    fireEvent.mouseDown(screen.getByText(hashed).closest("tr")!)
    fireEvent.mouseUp(window)
    await waitFor(() => expect(screen.getAllByText(hashed).length).toBeGreaterThan(1))
    expect(document.body.innerHTML).not.toContain("Hidden Person")

    // Clicking the name does not reveal it.
    await user.click(screen.getAllByText(hashed)[0])
    expect(screen.queryByText("Hidden Person")).toBeNull()

    await user.click(screen.getByRole("button", { name: /reveal all/i }))
    expect((await screen.findAllByText("Hidden Person")).length).toBeGreaterThan(0)
  })

  it("search matches the real name while the name is hashed", async () => {
    const user = userEvent.setup()
    renderPage()
    const hashed = hashText("Hidden Person")
    await screen.findByText(hashed)
    await user.type(screen.getByPlaceholderText("Search artists…"), "hidden")
    await waitFor(() => expect(screen.queryByText("Open Person")).toBeNull())
    expect(screen.getByText(hashed)).toBeInTheDocument()
  })

  it("does not hash anything with privacy off", async () => {
    renderPage(false)
    expect(await screen.findByText("Hidden Person")).toBeInTheDocument()
  })
})

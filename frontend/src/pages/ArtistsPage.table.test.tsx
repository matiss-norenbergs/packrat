import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FloatingActionDock } from "@/components/FloatingActionDock"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ArtistsPage } from "@/pages/ArtistsPage"
import { callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"
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
  selectedImagePath: null,
  birthday: null,
  isPrivate: false,
  createdAt: "",
  usageCount: 0,
  ...over,
})

function serve(artists: Artist[], privacy = false) {
  return mockFetch((url, init) => {
    if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: privacy } }
    if (url.endsWith("/artists/bulk-delete") && init.method === "POST") return { status: 200, body: {} }
    if (url.endsWith("/artists")) return { status: 200, body: artists }
    if (/\/artists\/\d+\/images$/.test(url)) return { status: 200, body: [] }
    if (url.endsWith("/collections") || url.endsWith("/tags")) return { status: 200, body: [] }
    return { status: 404 }
  })
}

function renderPage() {
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

const row = (name: string) => screen.getByText(name).closest("tr")!
const select = (name: string) => {
  fireEvent.mouseDown(row(name))
  fireEvent.mouseUp(window)
}

describe("ArtistsPage table", () => {
  it("renders name, birthday with age or a dash, and the singular/plural usage badge", async () => {
    serve([
      artist(1, "Alpha", { birthday: "1990-01-05", usageCount: 1 }),
      artist(2, "Beta", { usageCount: 3 }),
    ])
    renderPage()
    await screen.findByText("Alpha")
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["", "Name", "Birthday", "Usage"])

    const alpha = within(row("Alpha"))
    expect(alpha.getByText(/Jan 5, 1990/)).toBeInTheDocument()
    expect(alpha.getByText(/^\(age \d+\)$/)).toBeInTheDocument()
    expect(alpha.getByText("1 item")).toBeInTheDocument()

    const beta = within(row("Beta"))
    expect(beta.getByText("—")).toBeInTheDocument()
    expect(beta.getByText("3 items")).toBeInTheDocument()
    expect(screen.getByText("2 artists")).toBeInTheDocument()
  })

  it("shows the Private column only when privacy is on", async () => {
    serve([artist(1, "Secret", { isPrivate: true }), artist(2, "Open")], true)
    renderPage()
    await screen.findByText("Secret")
    expect(screen.getByRole("columnheader", { name: "Private" })).toBeInTheDocument()
    expect(within(row("Secret")).getByLabelText("Private")).toBeInTheDocument()
    expect(within(row("Open")).queryByLabelText("Private")).toBeNull()
    cleanup()

    serve([artist(1, "Secret", { isPrivate: true })], false)
    renderPage()
    await screen.findByText("Secret")
    expect(screen.queryByRole("columnheader", { name: "Private" })).toBeNull()
    expect(screen.queryByLabelText("Private")).toBeNull()
  })

  it("filters by name when searching", async () => {
    serve([artist(1, "Alpha"), artist(2, "Beta"), artist(3, "Alphabet")])
    renderPage()
    await screen.findByText("Alpha")
    fireEvent.change(screen.getByPlaceholderText("Search artists…"), { target: { value: "ALPHA" } })
    await waitFor(() => expect(screen.queryByText("Beta")).toBeNull())
    expect(screen.getByText("Alpha")).toBeInTheDocument()
    expect(screen.getByText("Alphabet")).toBeInTheDocument()
    expect(screen.getByText("2 artists")).toBeInTheDocument()
  })

  it("shows the empty and no-match messages", async () => {
    serve([])
    renderPage()
    expect(await screen.findByText(/No artists yet\. Create one/)).toBeInTheDocument()
    cleanup()

    serve([artist(1, "Alpha")])
    renderPage()
    await screen.findByText("Alpha")
    fireEvent.change(screen.getByPlaceholderText("Search artists…"), { target: { value: "zzz" } })
    expect(await screen.findByText(/No artists match "zzz"/)).toBeInTheDocument()
    expect(screen.getByText("0 artists")).toBeInTheDocument()
  })

  it("drives the images panel from the selection: one artist shows it, several show a count", async () => {
    const fetchMock = serve([artist(1, "Alpha", { selectedImagePath: "a.jpg" }), artist(2, "Beta"), artist(3, "Gamma")])
    renderPage()
    await screen.findByText("Alpha")
    expect(screen.getByText("Select an artist to see its images.")).toBeInTheDocument()

    select("Alpha")
    expect(await screen.findByRole("heading", { name: "Alpha" })).toBeInTheDocument()
    await waitFor(() => expect(callsTo(fetchMock, "/artists/1/images")).toHaveLength(1))

    fireEvent.mouseDown(row("Gamma"), { ctrlKey: true })
    expect(await screen.findByText("2 artists selected.")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Alpha" })).toBeNull()

    select("Beta")
    expect(await screen.findByRole("heading", { name: "Beta" })).toBeInTheDocument()
  })

  it("confirms bulk delete with the selection count and posts the ids", async () => {
    const fetchMock = serve([artist(1, "Alpha"), artist(2, "Beta"), artist(3, "Gamma")])
    renderPage()
    await screen.findByText("Alpha")
    const del = screen.getByRole("button", { name: "Delete" })
    expect(del).toBeDisabled()
    select("Alpha")
    fireEvent.mouseDown(row("Gamma"), { ctrlKey: true })
    fireEvent.click(del)
    expect(await screen.findByText("Delete 2 selected artists?")).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!)
    await waitFor(() => expect(callsTo(fetchMock, "/artists/bulk-delete")).toHaveLength(1))
    expect(JSON.parse((callsTo(fetchMock, "/artists/bulk-delete")[0][1] as RequestInit).body as string)).toEqual({ ids: [1, 3] })
  })

  it("context menu: New / Edit / Delete, with Edit enabled only for exactly one row", async () => {
    serve([artist(1, "Alpha"), artist(2, "Beta")])
    renderPage()
    await screen.findByText("Alpha")

    fireEvent.contextMenu(row("Alpha"))
    expect(await screen.findByRole("menuitem", { name: "New Artist" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Edit" })).not.toHaveAttribute("data-disabled")
    expect(screen.getByRole("menuitem", { name: "Delete" })).not.toHaveAttribute("data-disabled")
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    cleanup()

    serve([artist(1, "Alpha"), artist(2, "Beta")])
    renderPage()
    await screen.findByText("Alpha")
    select("Alpha")
    fireEvent.mouseDown(row("Beta"), { ctrlKey: true })
    fireEvent.contextMenu(row("Alpha"))
    expect(await screen.findByRole("menuitem", { name: "Delete (2)" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveAttribute("data-disabled")
  })

  it("paginates at 50 rows per page and clears the dock only conditionally", async () => {
    serve(Array.from({ length: 120 }, (_, i) => artist(i + 1, `Artist ${String(i + 1).padStart(3, "0")}`)))
    renderPage()
    await screen.findByText("Artist 001")
    expect(screen.getAllByRole("row")).toHaveLength(51)
    const label = screen.getByText("120 artists")
    expect(label).toHaveClass("dock-occupied:pl-12")
    expect(label).not.toHaveClass("pl-12")
    expect(label.parentElement).toHaveClass("dock-occupied:flex-wrap-reverse")
    expect(label.parentElement).not.toHaveClass("flex-wrap-reverse")
    fireEvent.click(screen.getByRole("button", { name: "3" }))
    expect(await screen.findByText("Artist 101")).toBeInTheDocument()
    expect(screen.getAllByRole("row")).toHaveLength(21)
  })
})

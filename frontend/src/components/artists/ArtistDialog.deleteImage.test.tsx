import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ArtistDialog } from "@/components/artists/ArtistDialog"
import { TooltipProvider } from "@/components/ui/tooltip"
import { callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"
import type { Artist } from "@/types/api"

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

// Deleting an artist image removes its file from disk, so the tile's Delete button asks first (every pointer type).
const ARTIST: Artist = { id: 7, name: "Old", selectedImagePath: "artists/7/b.jpg", birthday: null, isPrivate: false, createdAt: "", usageCount: 0 }
const IMAGES = [
  { id: 5, relativePath: "artists/7/a.jpg" },
  { id: 6, relativePath: "artists/7/b.jpg" },
]

function setup(deleteStatus = 204) {
  let images = [...IMAGES]
  const fetchMock = mockFetch((url, init) => {
    if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: false } }
    const del = /\/artists\/7\/images\/(\d+)$/.exec(url)
    if (del && init.method === "DELETE") {
      if (deleteStatus === 204) images = images.filter((i) => i.id !== Number(del[1]))
      return deleteStatus === 204 ? { status: 204 } : { status: deleteStatus, body: { error: "disk on fire" } }
    }
    if (url.endsWith("/artists/7/images")) return { status: 200, body: images }
    return { status: 200, body: [] }
  })
  renderWithProviders(
    <TooltipProvider>
      <ArtistDialog open onOpenChange={() => {}} artist={ARTIST} />
    </TooltipProvider>,
  )
  return fetchMock
}

const deletes = (f: ReturnType<typeof mockFetch>) => f.mock.calls.filter(([u, i]) => /\/images\/\d+$/.test(u) && i.method === "DELETE")

beforeEach(() => vi.clearAllMocks())

describe("ArtistDialog image delete confirmation", () => {
  it("asks first and sends nothing until confirmed", async () => {
    const user = userEvent.setup()
    const fetchMock = setup()
    const [, second] = await screen.findAllByRole("button", { name: "Delete image" })
    await user.click(second!)
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("current display image")
    expect(deletes(fetchMock)).toHaveLength(0)
  })

  it("Cancel deletes nothing", async () => {
    const user = userEvent.setup()
    const fetchMock = setup()
    const [first] = await screen.findAllByRole("button", { name: "Delete image" })
    await user.click(first!)
    await user.click(await screen.findByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(deletes(fetchMock)).toHaveLength(0)
    expect(screen.getAllByRole("button", { name: "Delete image" })).toHaveLength(2)
    expect(first).toHaveFocus()
  })

  it("Escape closes it without deleting", async () => {
    const user = userEvent.setup()
    const fetchMock = setup()
    const [first] = await screen.findAllByRole("button", { name: "Delete image" })
    await user.click(first!)
    await screen.findByRole("alertdialog")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(deletes(fetchMock)).toHaveLength(0)
    expect(screen.getByRole("dialog", { name: /Artist/ })).toBeInTheDocument()
  })

  it("Confirm sends exactly one request for that image, the list updates and focus stays in the dialog", async () => {
    const user = userEvent.setup()
    const fetchMock = setup()
    const [first] = await screen.findAllByRole("button", { name: "Delete image" })
    await user.click(first!)
    await user.click(await screen.findByRole("button", { name: "Delete" }))
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Delete image" })).toHaveLength(1))
    expect(deletes(fetchMock)).toHaveLength(1)
    expect(callsTo(fetchMock, "/artists/7/images/5")).toHaveLength(1)
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload images" })).toHaveFocus())
  })

  it("a failed request keeps the image and reports it", async () => {
    const user = userEvent.setup()
    const fetchMock = setup(500)
    const [first] = await screen.findAllByRole("button", { name: "Delete image" })
    await user.click(first!)
    await user.click(await screen.findByRole("button", { name: "Delete" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Failed to delete image")))
    expect(deletes(fetchMock)).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "Delete image" })).toHaveLength(2)
  })
})

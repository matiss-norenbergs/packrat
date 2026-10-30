import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TagsPage } from "@/pages/TagsPage"
import { callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"
import type { Tag } from "@/types/api"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const tag = (id: number, name: string, over: Partial<Tag> = {}): Tag => ({
  id,
  name,
  isPrivate: false,
  createdAt: "",
  usageCount: 0,
  ...over,
})

function serve(tags: Tag[], privacy = false) {
  return mockFetch((url, init) => {
    if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: privacy } }
    if (url.endsWith("/tags/bulk-delete") && init.method === "POST") return { status: 200, body: {} }
    if (url.endsWith("/tags")) return { status: 200, body: tags }
    return { status: 404 }
  })
}

const row = (name: string) => screen.getByText(name).closest("tr")!

describe("TagsPage", () => {
  it("lists tags with usage badges and the footer count", async () => {
    serve([tag(1, "Alpha", { usageCount: 1 }), tag(2, "Beta", { usageCount: 3 })])
    renderWithProviders(<TagsPage />)
    expect(await screen.findByText("Alpha")).toBeInTheDocument()
    expect(screen.getByText("1 item")).toBeInTheDocument()
    expect(screen.getByText("3 items")).toBeInTheDocument()
    expect(screen.getByText("2 tags")).toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "Private" })).toBeNull()
  })

  it("shows the Private column with a lock only when privacy is on", async () => {
    serve([tag(1, "Secret", { isPrivate: true }), tag(2, "Open")], true)
    renderWithProviders(<TagsPage />)
    await screen.findByText("Secret")
    expect(screen.getByRole("columnheader", { name: "Private" })).toBeInTheDocument()
    expect(screen.getAllByLabelText("Private")).toHaveLength(1)
  })

  it("shows the empty and no-match messages", async () => {
    serve([])
    renderWithProviders(<TagsPage />)
    expect(await screen.findByText(/No tags yet/)).toBeInTheDocument()
    cleanup()

    serve([tag(1, "Alpha")])
    renderWithProviders(<TagsPage />)
    await screen.findByText("Alpha")
    fireEvent.change(screen.getByPlaceholderText("Search tags…"), { target: { value: "zzz" } })
    expect(await screen.findByText(/No tags match "zzz"/)).toBeInTheDocument()
  })

  it("confirms bulk delete with the selection count and posts the ids", async () => {
    const fetchMock = serve([tag(1, "Alpha"), tag(2, "Beta"), tag(3, "Gamma")])
    renderWithProviders(<TagsPage />)
    await screen.findByText("Alpha")
    const del = screen.getByRole("button", { name: "Delete" })
    expect(del).toBeDisabled()
    fireEvent.mouseDown(row("Alpha"))
    fireEvent.mouseUp(window)
    fireEvent.mouseDown(row("Gamma"), { ctrlKey: true })
    fireEvent.click(del)
    expect(await screen.findByText("Delete 2 selected tags?")).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!)
    await waitFor(() => expect(callsTo(fetchMock, "/tags/bulk-delete")).toHaveLength(1))
    expect(JSON.parse((callsTo(fetchMock, "/tags/bulk-delete")[0][1] as RequestInit).body as string)).toEqual({ ids: [1, 3] })
  })

  it("right-click menu mirrors the toolbar: Edit is disabled for a multi-selection", async () => {
    serve([tag(1, "Alpha"), tag(2, "Beta")])
    renderWithProviders(<TagsPage />)
    await screen.findByText("Alpha")
    fireEvent.mouseDown(row("Alpha"))
    fireEvent.mouseUp(window)
    fireEvent.mouseDown(row("Beta"), { ctrlKey: true })
    fireEvent.contextMenu(row("Alpha"))
    expect(await screen.findByRole("menuitem", { name: "Delete (2)" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveAttribute("data-disabled")
  })

  it("paginates at 50 rows per page", async () => {
    serve(Array.from({ length: 120 }, (_, i) => tag(i + 1, `Tag ${String(i + 1).padStart(3, "0")}`)))
    renderWithProviders(<TagsPage />)
    await screen.findByText("Tag 001")
    expect(screen.getAllByRole("row")).toHaveLength(51)
    expect(screen.getByText("120 tags")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "3" }))
    expect(await screen.findByText("Tag 101")).toBeInTheDocument()
    expect(screen.getAllByRole("row")).toHaveLength(21)
  })
})

import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { ArtistDialog } from "@/components/artists/ArtistDialog"
import { TooltipProvider } from "@/components/ui/tooltip"
import { bodyOf, callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"
import type { Artist } from "@/types/api"

afterEach(cleanup)

const EXISTING: Artist = {
  id: 7,
  name: "Old",
  selectedImagePath: null,
  birthday: null,
  isPrivate: true,
  createdAt: "",
  usageCount: 0,
}

function setup(privacy: boolean, artist?: Artist) {
  const fetchMock = mockFetch((url, init) => {
    if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: privacy } }
    if (url.endsWith("/artists") && init.method === "POST") return { status: 201, body: { id: 1 } }
    if (/\/artists\/7$/.test(url) && init.method === "PATCH") return { status: 204 }
    if (url.includes("/images")) return { status: 200, body: [] }
    return { status: 200, body: [] }
  })
  renderWithProviders(
    <TooltipProvider>
      <ArtistDialog open onOpenChange={() => {}} artist={artist} />
    </TooltipProvider>,
  )
  return fetchMock
}

describe("ArtistDialog private checkbox", () => {
  it("is hidden with privacy off", async () => {
    setup(false)
    await screen.findByText("New Artist")
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByLabelText("Private")).toBeNull()
  })

  it("is sent on create", async () => {
    const user = userEvent.setup()
    const fetchMock = setup(true)
    await user.type(await screen.findByLabelText("Name"), "New")
    await user.click(await screen.findByLabelText("Private"))
    await user.click(screen.getByRole("button", { name: "Create" }))
    await waitFor(() => expect(callsTo(fetchMock, "/artists").some(([, i]) => i.method === "POST")).toBe(true))
    const call = callsTo(fetchMock, "/artists").find(([, i]) => i.method === "POST")!
    expect(bodyOf(call)).toMatchObject({ name: "New", isPrivate: true })
  })

  it("is prefilled on edit and the cleared value is sent on update", async () => {
    const user = userEvent.setup()
    const fetchMock = setup(true, EXISTING)
    const box = await screen.findByLabelText("Private")
    await waitFor(() => expect(box).toHaveAttribute("data-state", "checked"))
    await user.click(box)
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(callsTo(fetchMock, "/artists/7").some(([, i]) => i.method === "PATCH")).toBe(true))
    const call = callsTo(fetchMock, "/artists/7").find(([, i]) => i.method === "PATCH")!
    expect(bodyOf(call)).toMatchObject({ name: "Old", isPrivate: false })
  })
})

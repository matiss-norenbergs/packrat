import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AddGhostLibraryItemDialog } from "@/components/library/AddGhostLibraryItemDialog"
import { bodyOf, callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"

beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }))
})

const col = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  parentId: null,
  rootPath: "",
  path: name,
  defaultQuality: "best",
  defaultDownloadType: "video",
  filenameTemplate: "",
  isPrivate: false,
  seasonNumber: null,
  year: null,
  sequenceMin: null,
  sequenceMax: null,
  artistId: null,
  ...extra,
})

const COLLECTIONS = [
  col(1, "Shows", { artistId: 7 }),
  col(2, "Shows/Season Two", { parentId: 1, seasonNumber: 2, year: 2021, defaultDownloadType: "audio" }),
  col(3, "Plain"),
  col(4, "Pictures", { defaultDownloadType: "image" }),
  col(5, "Other", { seasonNumber: 5, year: 1999, artistId: 8 }),
]

function serve() {
  return mockFetch((url) => {
    if (url.endsWith("/collections")) return { status: 200, body: COLLECTIONS }
    if (url.endsWith("/artists")) return { status: 200, body: [{ id: 7, name: "Seven" }, { id: 8, name: "Eight" }] }
    if (url.endsWith("/tags")) return { status: 200, body: [] }
    if (url.endsWith("/library/ghost")) return { status: 201, body: { id: 1 } }
    return { status: 404 }
  })
}

function setup() {
  const fetchMock = serve()
  renderWithProviders(<AddGhostLibraryItemDialog open onOpenChange={() => {}} />)
  return { fetchMock, user: userEvent.setup() }
}

async function pickCollection(user: ReturnType<typeof userEvent.setup>, path: string) {
  const triggers = screen.getAllByRole("combobox")
  await user.click(triggers[1]) // Type, Collection, Artist
  await user.click(await screen.findByRole("option", { name: path }))
}

const season = () => screen.getByLabelText("Season #") as HTMLInputElement
const year = () => screen.getByLabelText("Year") as HTMLInputElement
const combos = () => screen.getAllByRole("combobox")

describe("Add item: picking a collection", () => {
  it("fills Season, Year, the inherited Artist and the media type", async () => {
    const { user } = setup()
    await screen.findByLabelText("Season #")
    await pickCollection(user, "Shows/Season Two")
    expect(season().value).toBe("2")
    expect(year().value).toBe("2021")
    await waitFor(() => expect(combos()[2]).toHaveTextContent("Seven"))
    expect(combos()[0]).toHaveTextContent("Audio")
  })

  it("never clears fields a collection doesn't define", async () => {
    const { user } = setup()
    await user.type(await screen.findByLabelText("Season #"), "9")
    await user.type(year(), "2000")
    await pickCollection(user, "Plain")
    expect(season().value).toBe("9")
    expect(year().value).toBe("2000")
  })

  it("keeps the current video/audio choice for an Image collection", async () => {
    const { user } = setup()
    await screen.findByLabelText("Season #")
    await pickCollection(user, "Shows/Season Two")
    expect(combos()[0]).toHaveTextContent("Audio")
    await pickCollection(user, "Pictures")
    expect(combos()[0]).toHaveTextContent("Audio")
  })

  it("replaces the values when another collection is picked and sends them", async () => {
    const { user, fetchMock } = setup()
    await screen.findByLabelText("Season #")
    await pickCollection(user, "Shows/Season Two")
    await pickCollection(user, "Other")
    expect(season().value).toBe("5")
    expect(year().value).toBe("1999")
    await waitFor(() => expect(combos()[2]).toHaveTextContent("Eight"))

    await user.type(screen.getByLabelText("Title"), "Ep")
    await user.click(screen.getByRole("button", { name: "Add item" }))
    await waitFor(() => expect(callsTo(fetchMock, "/library/ghost")).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, "/library/ghost")[0])).toMatchObject({
      collectionId: 5,
      artistId: 8,
      year: 1999,
      seasonNumber: 5,
    })
  })
})

import { cleanup, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NewDownloadDialog } from "@/components/downloads/NewDownloadDialog"
import { mockFetch, renderWithProviders } from "@/test/mockApi"

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
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
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
  col(1, "Templated", { filenameTemplate: "{title} - {year}" }),
  col(2, "Seasoned", { seasonNumber: 4 }),
  col(3, "Plain"),
]

async function open() {
  mockFetch((url) => {
    if (url.endsWith("/collections")) return { status: 200, body: COLLECTIONS }
    if (url.endsWith("/settings")) return { status: 200, body: {} }
    if (url.endsWith("/tags") || url.endsWith("/artists")) return { status: 200, body: [] }
    return { status: 404 }
  })
  renderWithProviders(<NewDownloadDialog />)
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: /New Download/ }))
  return user
}

async function pick(user: ReturnType<typeof userEvent.setup>, path: string) {
  await user.click(screen.getAllByRole("combobox")[0])
  await user.click(await screen.findByRole("option", { name: path }))
}

describe("New Download: picking a collection", () => {
  it("fills the filename template only when it is empty, and opens Advanced", async () => {
    const user = await open()
    await screen.findByPlaceholderText("https://...")
    expect(screen.queryByLabelText("Season #")).toBeNull() // Advanced collapsed
    await pick(user, "Templated")
    const template = (await screen.findByLabelText(/Filename template/i)) as HTMLInputElement
    expect(template.value).toBe("{title} - {year}")

    await user.clear(template)
    await user.type(template, "custom")
    await pick(user, "Plain")
    await pick(user, "Templated")
    expect(template.value).toBe("custom")
  })

  it("replaces a typed Season # when the collection has one", async () => {
    const user = await open()
    await screen.findByPlaceholderText("https://...")
    await pick(user, "Plain")
    expect(screen.queryByLabelText("Season #")).toBeNull() // nothing to show, stays closed
    await pick(user, "Seasoned")
    const season = (await screen.findByLabelText("Season #")) as HTMLInputElement
    expect(season.value).toBe("4")
  })
})

import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NewDownloadDialog } from "@/components/downloads/NewDownloadDialog"
import { bodyOf, callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"

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

const PURE = "https://example.com/playlist?list=PL1"
const MIXED = "https://example.com/watch?v=1&list=PL1"

const playlistPreview = (singleVideoAvailable: boolean) => ({
  title: "",
  uploader: "",
  uploadDate: "",
  duration: 0,
  thumbnail: "",
  resolution: null,
  isPlaylist: true,
  playlistTitle: "Some playlist",
  playlistCount: 3,
  singleVideoAvailable,
  duplicate: null,
})

function serve() {
  return mockFetch((url, init) => {
    if (url.endsWith("/downloads/preview")) {
      const target = (JSON.parse(init.body as string) as { url: string }).url
      return { status: 200, body: playlistPreview(target !== PURE) }
    }
    if (url.endsWith("/downloads/playlist")) return { status: 201, body: { queued: [], skipped: [], failed: [] } }
    if (url.endsWith("/settings")) return { status: 200, body: {} }
    if (url.endsWith("/collections") || url.endsWith("/tags") || url.endsWith("/artists")) return { status: 200, body: [] }
    return { status: 404 }
  })
}

async function open() {
  renderWithProviders(<NewDownloadDialog />)
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: /New Download/ }))
  return user
}

async function typeUrl(user: ReturnType<typeof userEvent.setup>, url: string) {
  const input = await screen.findByPlaceholderText("https://...")
  await user.clear(input)
  await user.type(input, url)
}

const onlyThisVideo = () => screen.findByRole("button", { name: "Only this video" }, { timeout: 5000 })

describe("New Download: Only this video on a playlist link", () => {
  it("is disabled for a pure playlist link, and Queue Playlist sends entire", async () => {
    const fetchMock = serve()
    const user = await open()
    await typeUrl(user, PURE)
    expect(await onlyThisVideo()).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Queue Playlist" }))
    await waitFor(() => expect(callsTo(fetchMock, "/downloads/playlist")).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, "/downloads/playlist")[0]).playlistMode).toBe("entire")
  })

  it("is enabled for a watch?v&list link and can be queued", async () => {
    const fetchMock = serve()
    const user = await open()
    await typeUrl(user, MIXED)
    const btn = await onlyThisVideo()
    expect(btn).toBeEnabled()

    await user.click(btn)
    await user.click(screen.getByRole("button", { name: "Queue Playlist" }))
    await waitFor(() => expect(callsTo(fetchMock, "/downloads/playlist")).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, "/downloads/playlist")[0]).playlistMode).toBe("current")
  })

  it("re-evaluates when the URL changes after Only this video was picked", async () => {
    const fetchMock = serve()
    const user = await open()
    await typeUrl(user, MIXED)
    await user.click(await onlyThisVideo())

    await typeUrl(user, PURE)
    await waitFor(() => expect(screen.getByRole("button", { name: "Only this video" })).toBeDisabled(), { timeout: 5000 })

    await user.click(screen.getByRole("button", { name: "Queue Playlist" }))
    await waitFor(() => expect(callsTo(fetchMock, "/downloads/playlist")).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, "/downloads/playlist")[0]).playlistMode).toBe("entire")
  })
})
